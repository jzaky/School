// One person's data across modules: who they are and which rows point at them.
// The pointer map is read from the Prisma schema, so new tenant tables with a studentId, guardianId or
// membership pointer are picked up automatically by data subject exports and erasure.
import { Prisma } from "@prisma/client";
import type { TenantDb, TenantTx } from "@/lib/tenant-db";

export type SubjectKind = "student" | "guardian" | "staff";
export type SubjectRef = { kind: SubjectKind; id: string };

export type Subject = {
  kind: SubjectKind;
  /** Student.id, Guardian.id or Membership.id (staff). */
  id: string;
  orgId: string;
  membershipId: string | null;
  userId: string | null;
  name: { en: string; ar: string };
  /** What the admin types to confirm an erasure: student number, or the person's id suffix. */
  reference: string;
  anonymisedAt: Date | null;
};

type AnyDb = TenantDb | TenantTx;

export const SUBJECT_KINDS: SubjectKind[] = ["student", "guardian", "staff"];
export const isSubjectKind = (v: unknown): v is SubjectKind => typeof v === "string" && (SUBJECT_KINDS as string[]).includes(v);

/** Fields that hold the person's own membership id (not a role they played for someone else). */
export const MEMBER_FIELDS = ["membershipId", "recipientId", "requesterId", "submittedById", "bookedById"] as const;
const STUDENT_FIELDS = ["studentId"] as const;
const GUARDIAN_FIELDS = ["guardianId", "toGuardianId"] as const;

/** Models never collected through pointers: the person rows themselves, logs and platform bookkeeping. */
const SKIP_MODELS = new Set(["Membership", "Student", "Guardian", "AuditEvent", "DemoPersona", "DataExport", "DataSubjectRequest", "JobRun", "PlatformAuditEvent", "Organization"]);

export const delegateName = (model: string) => model.charAt(0).toLowerCase() + model.slice(1);

type Delegate = {
  findMany: (args: unknown) => Promise<Array<Record<string, unknown>>>;
  count: (args: unknown) => Promise<number>;
  deleteMany: (args: unknown) => Promise<{ count: number }>;
  updateMany: (args: unknown) => Promise<{ count: number }>;
};
export const delegate = (db: AnyDb, model: string) => (db as unknown as Record<string, Delegate>)[delegateName(model)];

export type PointerSpec = { model: string; or: Array<Record<string, string>>; hasCaseId: boolean; hasSensitivity: boolean };

/** Every tenant model with at least one field pointing at this person, and the filter to find those rows. */
export function subjectPointers(subject: Pick<Subject, "kind" | "id" | "membershipId">): PointerSpec[] {
  const out: PointerSpec[] = [];
  for (const m of Prisma.dmmf.datamodel.models) {
    if (SKIP_MODELS.has(m.name)) continue;
    const names = new Set(m.fields.filter((f) => f.kind === "scalar").map((f) => f.name));
    if (!names.has("orgId")) continue;
    const or: Array<Record<string, string>> = [];
    if (subject.kind === "student") for (const f of STUDENT_FIELDS) if (names.has(f)) or.push({ [f]: subject.id });
    if (subject.kind === "guardian") for (const f of GUARDIAN_FIELDS) if (names.has(f)) or.push({ [f]: subject.id });
    if (subject.membershipId) for (const f of MEMBER_FIELDS) if (names.has(f)) or.push({ [f]: subject.membershipId });
    if (or.length) out.push({ model: m.name, or, hasCaseId: names.has("caseId"), hasSensitivity: names.has("sensitivity") });
  }
  return out.sort((a, b) => a.model.localeCompare(b.model));
}

/** Every tenant model (name and whether orgId is nullable, as for shared catalog tables). */
export function tenantModels(): Array<{ model: string; nullableOrg: boolean; fields: string[] }> {
  return Prisma.dmmf.datamodel.models
    .map((m) => {
      const org = m.fields.find((f) => f.name === "orgId");
      return org ? { model: m.name, nullableOrg: !org.isRequired, fields: m.fields.filter((f) => f.kind === "scalar").map((f) => f.name) } : null;
    })
    .filter((x): x is { model: string; nullableOrg: boolean; fields: string[] } => x !== null)
    .sort((a, b) => a.model.localeCompare(b.model));
}

export async function resolveSubject(db: AnyDb, orgId: string, ref: SubjectRef): Promise<Subject | null> {
  // Both client shapes share the same model API; narrowing to one avoids a union TypeScript cannot compare.
  const q = db as TenantTx;
  if (!ref?.id || !isSubjectKind(ref.kind)) return null;
  if (ref.kind === "student") {
    const s = await q.student.findFirst({ where: { id: ref.id, orgId }, include: { membership: true } });
    if (!s) return null;
    return {
      kind: "student",
      id: s.id,
      orgId,
      membershipId: s.membershipId,
      userId: s.membership?.userId ?? null,
      name: { en: `${s.firstNameEn} ${s.lastNameEn}`.trim(), ar: `${s.firstNameAr} ${s.lastNameAr}`.trim() },
      reference: s.studentNo,
      anonymisedAt: s.anonymisedAt,
    };
  }
  if (ref.kind === "guardian") {
    const g = await q.guardian.findFirst({ where: { id: ref.id, orgId }, include: { membership: true } });
    if (!g) return null;
    return {
      kind: "guardian",
      id: g.id,
      orgId,
      membershipId: g.membershipId,
      userId: g.membership?.userId ?? null,
      name: { en: `${g.firstNameEn} ${g.lastNameEn}`.trim(), ar: `${g.firstNameAr} ${g.lastNameAr}`.trim() },
      reference: `G-${g.id.slice(-6).toUpperCase()}`,
      anonymisedAt: g.anonymisedAt,
    };
  }
  const m = await q.membership.findFirst({ where: { id: ref.id, orgId }, include: { user: true, staffProfile: true, student: true, guardian: true } });
  if (!m || m.student || m.guardian) return null;
  return {
    kind: "staff",
    id: m.id,
    orgId,
    membershipId: m.id,
    userId: m.userId,
    name: { en: m.user.nameEn, ar: m.user.nameAr ?? m.user.nameEn },
    reference: m.staffProfile?.employeeNo || `M-${m.id.slice(-6).toUpperCase()}`,
    anonymisedAt: m.anonymisedAt,
  };
}

/** Rows in every module that point at the person, keyed by model name. */
export async function collectSubjectRows(db: AnyDb, orgId: string, subject: Subject): Promise<Map<string, Array<Record<string, unknown>>>> {
  const out = new Map<string, Array<Record<string, unknown>>>();
  for (const p of subjectPointers(subject)) {
    const rows = await delegate(db, p.model).findMany({ where: { orgId, OR: p.or } });
    if (rows.length) out.set(p.model, rows);
  }
  return out;
}

/** Field names never written to export files: encrypted values, secrets and tokens. */
export function isSecretField(name: string) {
  return /Enc$|^passwordHash$|token|secret|^tokenHash$|^codeHash$/i.test(name);
}

export function scrubRow(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) if (!isSecretField(k)) out[k] = v;
  return out;
}
