// Publishing reviewed requirement data.
// - Approve (optionally with edits): a new ProgramRequirement version per curriculum group (version+1,
//   confidence REVIEWED, verifiedAt/By, sourceId, extractionId, evidence on every line); the previous
//   current version is closed (isCurrent false, effectiveTo); a RequirementChange with a structured diff,
//   severity and English/Arabic summary is recorded under a deterministic id.
// - Reject: status REJECTED with a note. Verify: a person checked the official page (confidence VERIFIED).
// Writes to global rows use the platform catalog client after assertCatalogWrite; every action writes an
// AuditEvent in the actor's own organization. No "server-only" marker: tests and the worker import it.
import type { Prisma, PrismaClient, SchoolCurriculum } from "@prisma/client";
import type { TenantDb } from "@/lib/tenant-db";
import { audit } from "@/server/audit/audit";
import { CatalogAccessError, assertCatalogWrite, type CatalogActor } from "@/server/platform/catalog-db";
import { changeId, diffGroups, type SubjectLabels } from "./diff";
import { loadVocab } from "./extract";
import { validateDraft } from "./validate";
import { canonicalSourceType, isOfficial } from "./sources";
import type { ChangeDiff, Curriculum, DraftGroup, DraftSet, RejectedLine } from "./types";

export type PublishDeps = { catalog: PrismaClient; tenant: TenantDb; actor: CatalogActor; now?: Date; writable?: boolean };
export type PublishError =
  | "forbidden"
  | "not_platform_reviewer"
  | "no_owner_url"
  | "not_found"
  | "not_pending"
  | "no_program"
  | "mirror_cannot_override"
  | "invalid_edit"
  | "empty"
  | "note_required";
export type PublishResult<T = object> = ({ ok: true } & T) | { ok: false; error: PublishError; rejected?: RejectedLine[] };


type VersionWithLines = Prisma.ProgramRequirementGetPayload<{ include: { subjects: true; languages: true; tests: true; additional: true } }>;

/** The lines of a stored version in draft form, so versions and drafts diff the same way. */
export function groupFromVersion(v: VersionWithLines): DraftGroup {
  return {
    curriculum: (v.curriculum ?? null) as Curriculum | null,
    overall: [
      ...(v.gradeProfile ? [{ field: "gradeProfile" as const, value: v.gradeProfile, evidenceQuote: "" }] : []),
      ...(v.minimumPoints !== null ? [{ field: "minimumPoints" as const, value: v.minimumPoints, evidenceQuote: "" }] : []),
      ...(v.minimumGPA !== null ? [{ field: "minimumGPA" as const, value: v.minimumGPA, evidenceQuote: "" }] : []),
      ...(v.minimumPercent !== null ? [{ field: "minimumPercent" as const, value: v.minimumPercent, evidenceQuote: "" }] : []),
    ],
    subjects: v.subjects.map((s) => ({ type: s.type, keys: s.canonicalSubjectKeys, minimumLevel: s.minimumLevel, minimumGrade: s.minimumGrade, evidenceQuote: s.evidenceQuote ?? "" })),
    languages: v.languages.map((l) => ({ test: l.test, minOverall: l.minOverall, minComponent: l.minComponent, evidenceQuote: l.evidenceQuote ?? "" })),
    tests: v.tests.map((t) => ({ test: t.test, policy: t.policy, minScore: t.minScore, evidenceQuote: t.evidenceQuote ?? "" })),
    additional: v.additional.map((a) => ({ kind: a.kind, required: a.required, noteEn: a.noteEn, evidenceQuote: a.evidenceQuote ?? "" })),
  };
}

export const LINES_INCLUDE = { subjects: true, languages: true, tests: true, additional: true } as const;

/** Nested create data for a version's lines. */
export function linesCreate(group: DraftGroup, orgId: string | null) {
  const overall = (f: string) => group.overall.find((o) => o.field === f)?.value;
  const num = (v: unknown) => (typeof v === "number" ? v : v === undefined || v === null ? null : Number(v));
  return {
    gradeProfile: (overall("gradeProfile") as string | undefined) ?? null,
    minimumPoints: num(overall("minimumPoints")) === null ? null : Math.round(num(overall("minimumPoints"))!),
    minimumGPA: num(overall("minimumGPA")),
    minimumPercent: num(overall("minimumPercent")),
    subjects: { create: group.subjects.map((s) => ({ orgId, type: s.type, canonicalSubjectKeys: s.keys, minimumLevel: s.minimumLevel ?? null, minimumGrade: s.minimumGrade ?? null, alternatives: [], evidenceQuote: s.evidenceQuote || null })) },
    languages: { create: group.languages.map((l) => ({ orgId, test: l.test, minOverall: l.minOverall, minComponent: l.minComponent ?? null, evidenceQuote: l.evidenceQuote || null })) },
    tests: { create: group.tests.map((t) => ({ orgId, test: t.test, policy: t.policy, minScore: t.minScore ?? null, evidenceQuote: t.evidenceQuote || null })) },
    additional: { create: group.additional.map((a) => ({ orgId, kind: a.kind, required: a.required, noteEn: a.noteEn ?? null, evidenceQuote: a.evidenceQuote || null })) },
  };
}

export async function subjectLabels(db: { canonicalSubject: { findMany(args: { select: { key: true; nameEn: true; nameAr: true } }): Promise<Array<{ key: string; nameEn: string; nameAr: string }>> } }): Promise<SubjectLabels> {
  const rows = await db.canonicalSubject.findMany({ select: { key: true, nameEn: true, nameAr: true } });
  return Object.fromEntries(rows.map((r) => [r.key, { en: r.nameEn, ar: r.nameAr }]));
}

function guard<R>(deps: PublishDeps, fn: () => Promise<R>): Promise<R | { ok: false; error: PublishError }> {
  try {
    assertCatalogWrite(deps.actor, { writable: deps.writable });
  } catch (e) {
    if (e instanceof CatalogAccessError) return Promise.resolve({ ok: false, error: e.code });
    throw e;
  }
  return fn();
}

/** Create a new current version of one (program, curriculum) row and record the change. Used by publish and the demo seed. */
export async function writeVersion(
  tx: Prisma.TransactionClient,
  input: {
    programId: string;
    orgId: string | null;
    group: DraftGroup;
    confidence: "REVIEWED" | "VERIFIED" | "EXAMPLE";
    sourceId: string | null;
    extractionId: string | null;
    verifiedById: string | null;
    now: Date;
    labels: SubjectLabels;
    sourceTypeChanged?: boolean;
    example?: boolean;
    demoKey?: string;
    review?: ChangeDiff["review"];
    intakeYear?: number;
  },
) {
  const curriculum = (input.group.curriculum ?? null) as SchoolCurriculum | null;
  const prev = await tx.programRequirement.findFirst({ where: { programId: input.programId, curriculum, isCurrent: true }, include: LINES_INCLUDE, orderBy: { version: "desc" } });
  const max = await tx.programRequirement.aggregate({ where: { programId: input.programId, curriculum }, _max: { version: true } });
  const version = (max._max.version ?? 0) + 1;
  const created = await tx.programRequirement.create({
    data: {
      orgId: input.orgId,
      programId: input.programId,
      intakeYear: input.intakeYear ?? prev?.intakeYear ?? input.now.getUTCFullYear() + 1,
      curriculum,
      version,
      isCurrent: true,
      effectiveFrom: input.now,
      confidence: input.confidence,
      sourceId: input.sourceId,
      extractionId: input.extractionId,
      verifiedAt: input.confidence === "EXAMPLE" ? null : input.now,
      verifiedById: input.confidence === "EXAMPLE" ? null : input.verifiedById,
      notesEn: prev?.notesEn ?? null,
      notesAr: prev?.notesAr ?? null,
      evidenceLocator: prev?.evidenceLocator ?? null,
      createdAt: input.now,
      ...linesCreate(input.group, input.orgId),
    },
  });
  if (prev) await tx.programRequirement.update({ where: { id: prev.id }, data: { isCurrent: false, effectiveTo: input.now } });
  const d = diffGroups({ prev: prev ? groupFromVersion(prev) : null, next: input.group, prevSourceId: prev?.sourceId ?? null, nextSourceId: input.sourceId, sourceTypeChanged: input.sourceTypeChanged, labels: input.labels });
  const id = changeId(["requirement-change", input.programId, curriculum, prev?.id ?? null, created.id]);
  const diff: ChangeDiff = { severity: d.severity, curriculum: d.curriculum, entries: d.entries, summaryAr: d.summaryAr, ...(input.example ? { example: true } : {}), ...(input.demoKey ? { demoKey: input.demoKey } : {}), ...(input.review ? { review: input.review } : {}) };
  await tx.requirementChange.createMany({
    data: [{ id, orgId: input.orgId, programId: input.programId, fromVersionId: prev?.id ?? null, toVersionId: created.id, summaryEn: d.summaryEn, diff: diff as unknown as Prisma.InputJsonValue, status: prev && !input.review ? "NEEDS_REVIEW" : "ACKNOWLEDGED", reviewedById: input.review?.byUserId ?? null, detectedAt: input.now }],
    skipDuplicates: true,
  });
  return { versionId: created.id, version, previousId: prev?.id ?? null, changeId: id, severity: d.severity };
}

/** Approve a pending extraction, optionally with reviewer edits (line values may change, evidence must stay verbatim). */
export function approveExtraction(deps: PublishDeps, input: { extractionId: string; edits?: DraftGroup[] | null; note?: string | null }): Promise<PublishResult<{ versions: Array<{ versionId: string; version: number; changeId: string }> }>> {
  return guard(deps, async () => {
    const { catalog, actor } = deps;
    const now = deps.now ?? new Date();
    const ext = await catalog.requirementExtraction.findUnique({ where: { id: input.extractionId }, include: { source: true } });
    if (!ext || (ext.orgId !== null && ext.orgId !== actor.orgId)) return { ok: false, error: "not_found" };
    if (ext.status !== "PENDING_REVIEW") return { ok: false, error: "not_pending" };
    const programId = ext.source.programId;
    if (!programId) return { ok: false, error: "no_program" };
    const program = await catalog.universityProgram.findUnique({ where: { id: programId }, select: { id: true, orgId: true } });
    if (!program || (program.orgId !== null && program.orgId !== actor.orgId)) return { ok: false, error: "no_program" };

    const draft = ext.normalizedJson as unknown as DraftSet;
    let groups = draft.groups ?? [];
    if (input.edits) {
      const vocab = await loadVocab(catalog);
      const res = validateDraft({ groups: input.edits }, ext.rawText, vocab, { allowEditedValues: true });
      if (res.rejected.length) return { ok: false, error: "invalid_edit", rejected: res.rejected };
      groups = res.groups;
    }
    if (!groups.length) return { ok: false, error: "empty" };

    // Mirrors never override official data.
    const currents = await catalog.programRequirement.findMany({ where: { programId, isCurrent: true, sourceId: { not: null } }, select: { sourceId: true, curriculum: true } });
    const currentSources = currents.length ? await catalog.requirementSource.findMany({ where: { id: { in: currents.map((c) => c.sourceId!) } }, select: { id: true, sourceType: true } }) : [];
    const typeById = new Map(currentSources.map((s) => [s.id, s.sourceType]));
    if (ext.source.sourceType === "MIRROR") {
      const curricula = new Set(groups.map((g) => g.curriculum ?? null));
      if (currents.some((c) => curricula.has(c.curriculum ?? null) && isOfficial(typeById.get(c.sourceId!) ?? ""))) return { ok: false, error: "mirror_cannot_override" };
    }

    const labels = await subjectLabels(catalog);
    const versions = await catalog.$transaction(async (tx) => {
      const out: Array<{ versionId: string; version: number; changeId: string }> = [];
      for (const g of groups) {
        const prevType = currents.find((c) => (c.curriculum ?? null) === (g.curriculum ?? null));
        const res = await writeVersion(tx, {
          programId,
          orgId: program.orgId,
          group: g,
          confidence: "REVIEWED",
          sourceId: ext.sourceId,
          extractionId: ext.id,
          verifiedById: actor.userId,
          now,
          labels,
          sourceTypeChanged: !!prevType && canonicalSourceType(typeById.get(prevType.sourceId!) ?? ext.source.sourceType) !== canonicalSourceType(ext.source.sourceType),
        });
        out.push(res);
      }
      await tx.requirementExtraction.update({ where: { id: ext.id }, data: { status: "APPROVED", reviewedById: actor.userId, reviewedAt: now, reviewNote: input.note?.slice(0, 1000) || null } });
      return out;
    });
    await audit(deps.tenant, actor.orgId, {
      actorId: actor.membershipId,
      actorUserId: actor.userId,
      action: input.edits ? "catalog.extraction.edit_approve" : "catalog.extraction.approve",
      entityType: "RequirementExtraction",
      entityId: ext.id,
      meta: { programId, sourceId: ext.sourceId, versions: versions.map((v) => v.versionId), changes: versions.map((v) => v.changeId) },
    });
    return { ok: true, versions };
  });
}

export function rejectExtraction(deps: PublishDeps, input: { extractionId: string; note: string }): Promise<PublishResult> {
  return guard(deps, async () => {
    const note = input.note.trim();
    if (!note) return { ok: false, error: "note_required" };
    const ext = await deps.catalog.requirementExtraction.findUnique({ where: { id: input.extractionId }, select: { id: true, orgId: true, status: true, sourceId: true } });
    if (!ext || (ext.orgId !== null && ext.orgId !== deps.actor.orgId)) return { ok: false, error: "not_found" };
    if (ext.status !== "PENDING_REVIEW") return { ok: false, error: "not_pending" };
    await deps.catalog.requirementExtraction.update({ where: { id: ext.id }, data: { status: "REJECTED", reviewedById: deps.actor.userId, reviewedAt: deps.now ?? new Date(), reviewNote: note.slice(0, 1000) } });
    await audit(deps.tenant, deps.actor.orgId, { actorId: deps.actor.membershipId, actorUserId: deps.actor.userId, action: "catalog.extraction.reject", entityType: "RequirementExtraction", entityId: ext.id, reason: note.slice(0, 500), meta: { sourceId: ext.sourceId } });
    return { ok: true };
  });
}

/** A counselor checked the current version against the official page. */
export function markVersionVerified(deps: PublishDeps, input: { requirementId: string }): Promise<PublishResult> {
  return guard(deps, async () => {
    const v = await deps.catalog.programRequirement.findUnique({ where: { id: input.requirementId }, select: { id: true, orgId: true, isCurrent: true, programId: true, sourceId: true } });
    if (!v || (v.orgId !== null && v.orgId !== deps.actor.orgId) || !v.isCurrent) return { ok: false, error: "not_found" };
    const now = deps.now ?? new Date();
    await deps.catalog.programRequirement.update({ where: { id: v.id }, data: { confidence: "VERIFIED", verifiedAt: now, verifiedById: deps.actor.userId } });
    await audit(deps.tenant, deps.actor.orgId, { actorId: deps.actor.membershipId, actorUserId: deps.actor.userId, action: "catalog.requirement.verify", entityType: "ProgramRequirement", entityId: v.id, meta: { programId: v.programId, sourceId: v.sourceId } });
    return { ok: true };
  });
}
