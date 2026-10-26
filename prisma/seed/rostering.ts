// Demo data for Sign-in and Rostering (relative to now, safe to re-run after a tenant wipe):
// - the school's sign-in options (ClassLink with a fictional tenant id, Google, Microsoft, UAE PASS, email links
//   and password; the school's own identity provider is named but not connected yet),
// - a ClassLink Roster Server connection that reads the demo's built-in OneRoster feed (src/server/rostering/
//   demo-feed.ts), with every unchanged record already linked, so "Preview changes" shows a short, realistic list,
// - two students who exist only for that story (one changed family name, one left),
// - three weeks of roster run history and two weeks of sign-in activity (no addresses in any audit meta).
import type { Prisma, PrismaClient } from "@prisma/client";
import type { SeedWorld } from "./demo";
import { at, id, rng, stableId } from "./lib";
import { DEMO_SLUG } from "../../src/server/demo/constants";
import { DEFAULT_OPTIONS } from "../../src/lib/rostering/options";
import { encryptCredentials } from "../../src/server/rostering/connections";
import { buildDemoFeed, DEMO_LEAVER_NO, DEMO_RENAMED_NO, DEMO_SCHOOL_SOURCED_ID } from "../../src/server/rostering/demo-feed";
import { emptyCounts, type Counts } from "../../src/server/rostering/plan";

const DAY = 86_400_000;

export async function seedRostering(w: SeedWorld) {
  await seedRosteringData(w.db, w.orgId, w.now, w);
}

export async function seedRosteringData(db: PrismaClient, orgId: string, now: Date, w?: Pick<SeedWorld, "personas" | "log">) {
  const log = w?.log ?? (() => undefined);
  if (await db.rosterConnection.findFirst({ where: { orgId } })) return;
  const org = await db.organization.findUnique({ where: { id: orgId }, select: { slug: true, curricula: true } });
  const isDemo = org?.slug === DEMO_SLUG;
  const admin = w?.personas.admin ?? (await db.membership.findFirst({ where: { orgId, roles: { some: { role: { key: "school_admin" } } } } }))?.id;
  if (!admin) return;
  const ago = (days: number, hours = 0) => new Date(now.getTime() - days * DAY - hours * 3_600_000);
  const rand = rng(4242);
  const r = () => rand.next();

  // 1. Sign-in options.
  await db.signInPolicy.create({
    data: {
      orgId,
      methods: ["password", "magic_link", "google", "microsoft", "classlink", "uaepass", "oidc"],
      staffSsoRequired: false,
      allowedDomains: ["horizon.example", "students.horizon.example"],
      matchBy: "EMAIL_OR_EXTERNAL_ID",
      selfJoinDomains: [],
      selfJoinApproval: true,
      // Tenant ids are unique across schools, so only the main demo school claims one.
      classlinkTenantId: isDemo ? "1907" : null,
      oidcName: "Horizon Staff Directory",
      uaePassEidMatch: true,
      updatedById: admin,
      createdAt: ago(30),
    },
  });

  // 2. Two students for the roster story.
  const year = await db.academicYear.findFirst({ where: { orgId, isCurrent: true }, select: { id: true } });
  const campus = await db.campus.findFirst({ where: { orgId, isMain: true }, select: { id: true } });
  const curriculum = org?.curricula?.[0];
  for (const s of [
    { no: DEMO_LEAVER_NO, first: ["Faris", "فارس"], last: ["Mahmoud", "محمود"], grade: 12 },
    { no: DEMO_RENAMED_NO, first: ["Reem", "ريم"], last: ["Haddad", "حداد"], grade: 10 },
  ]) {
    const st = await db.student.create({
      data: { id: stableId(orgId, "roster-student", s.no), orgId, studentNo: s.no, firstNameEn: s.first[0], firstNameAr: s.first[1], lastNameEn: s.last[0], lastNameAr: s.last[1], gradeLevel: s.grade, section: "A", campusId: campus?.id ?? null, enrolledOn: ago(400), ...(curriculum ? { curriculum } : {}) },
    });
    const homeroom = year ? await db.schoolClass.findFirst({ where: { orgId, academicYearId: year.id, gradeLevel: s.grade }, orderBy: [{ isHomeroom: "desc" }, { nameEn: "asc" }], select: { id: true } }) : null;
    if (homeroom) await db.enrollment.create({ data: { orgId, studentId: st.id, classId: homeroom.id } });
  }

  // 3. The connection and the links for everything the feed already matches.
  const connection = await db.rosterConnection.create({
    data: {
      orgId,
      provider: "classlink",
      name: "ClassLink Roster Server",
      baseUrl: "demo://horizon",
      authMode: "OAUTH1",
      credentialsEnc: encryptCredentials("OAUTH1", { key: "horizon-demo", secret: id() }),
      schoolIds: [DEMO_SCHOOL_SOURCED_ID],
      options: DEFAULT_OPTIONS as unknown as Prisma.InputJsonValue,
      schedule: "OFF",
      hour: 3,
      enabled: true,
      lastRunAt: ago(1, 3),
      lastStatus: "SUCCEEDED",
      lastDeltaAt: ago(1, 3),
      createdById: admin,
      createdAt: ago(21),
    },
  });
  const feed = await buildDemoFeed(db as unknown as Parameters<typeof buildDemoFeed>[0], orgId);
  const links: Prisma.RosterLinkCreateManyInput[] = [];
  const counts = emptyCounts();
  const kindKey: Record<string, keyof Counts> = { staff: "staff", student: "students", guardian: "guardians", class: "classes", enrollment: "enrollments" };
  for (const rec of feed.baseline) {
    const local = feed.local.get(rec.externalId);
    if (!local) continue;
    links.push({ orgId, provider: "classlink", kind: local.kind, externalId: rec.externalId, localId: local.localId, hash: rec.hash, lastSeenRunId: null, createdAt: ago(21) });
    const k = kindKey[local.kind];
    if (k && k !== "removalBlocked" && k !== "total") counts[k].create++;
  }
  // Parent and child links the feed knows.
  const pairs = feed.baseline.filter((rec) => rec.kind === "user" && (rec.data as { role: string }).role === "parent");
  const guardianLinks = await db.guardianLink.findMany({ where: { orgId }, select: { id: true, guardianId: true, studentId: true } });
  for (const p of pairs) {
    const g = feed.local.get(p.externalId);
    for (const a of (p.data as { agentIds: string[] }).agentIds) {
      const s = feed.local.get(a);
      const gl = g && s ? guardianLinks.find((x) => x.guardianId === g.localId && x.studentId === s.localId) : null;
      if (gl) links.push({ orgId, provider: "classlink", kind: "guardianLink", externalId: `${p.externalId}:${a}`, localId: gl.id, hash: "", createdAt: ago(21) });
    }
  }
  for (let i = 0; i < links.length; i += 1000) await db.rosterLink.createMany({ data: links.slice(i, i + 1000), skipDuplicates: true });

  // 4. Run history: the first full sync three weeks ago, then previews and syncs with small changes.
  const json = (v: unknown) => v as Prisma.InputJsonValue;
  const small = (seed: number): Counts => {
    const c = emptyCounts();
    const total = { staff: links.filter((l) => l.kind === "staff").length, students: links.filter((l) => l.kind === "student").length, guardians: links.filter((l) => l.kind === "guardian").length, classes: links.filter((l) => l.kind === "class").length, enrollments: links.filter((l) => l.kind === "enrollment").length };
    for (const k of ["staff", "students", "guardians", "classes", "enrollments"] as const) {
      const changed = Math.round(r() * (k === "enrollments" ? 6 : 2)) + (seed % 2);
      c[k].update = changed;
      c[k].unchanged = Math.max(0, total[k] - changed);
    }
    return c;
  };
  // An applied preview becomes the sync itself (same run), as in the app; a preview nobody applied expires.
  const history: Array<{ days: number; dryRun: boolean; status: string; counts: Counts | null; issues: number; errorCode?: string }> = [
    { days: 21, dryRun: false, status: "PARTIAL", counts, issues: 1 },
    { days: 14, dryRun: false, status: "PARTIAL", counts: small(1), issues: 1 },
    { days: 10, dryRun: true, status: "FAILED", counts: null, issues: 0, errorCode: "FETCH_TIMEOUT" },
    { days: 9, dryRun: true, status: "EXPIRED", counts: small(4), issues: 1 },
    { days: 7, dryRun: false, status: "SUCCEEDED", counts: small(2), issues: 0 },
    { days: 1, dryRun: false, status: "SUCCEEDED", counts: small(3), issues: 0 },
  ];
  const tk = [{ kind: "students", code: "UNKNOWN_GRADE", ext: "demo-new-4", label: "Maya Saleh", detail: "TK" }];
  await db.rosterRun.createMany({
    data: history.map((h, i) => {
      const started = ago(h.days, 3 - (h.dryRun ? 0.2 : 0) + i * 0.001);
      return {
        orgId,
        connectionId: connection.id,
        provider: "classlink",
        source: "API",
        trigger: "MANUAL",
        mode: "FULL",
        dryRun: h.dryRun,
        status: h.status,
        phase: "done",
        counts: h.counts ? json(h.counts) : undefined,
        issues: json(h.issues ? tk : []),
        changes: json([]),
        progressDone: 1,
        progressTotal: 1,
        errorCode: h.errorCode ?? null,
        actorId: admin,
        startedAt: started,
        finishedAt: new Date(started.getTime() + (h.errorCode ? 30_000 : 45_000)),
        appliedAt: h.dryRun ? null : new Date(started.getTime() + 45_000),
      };
    }),
  });

  // 5. Linked sign-in accounts and two weeks of sign-in activity.
  const memberships = await db.membership.findMany({ where: { orgId, status: "ACTIVE" }, select: { id: true, userId: true, student: { select: { id: true } }, guardian: { select: { id: true } } }, orderBy: { id: "asc" } });
  const staff = memberships.filter((m) => !m.student && !m.guardian);
  const students = memberships.filter((m) => m.student);
  const parents = memberships.filter((m) => m.guardian);
  const identities: Prisma.SsoIdentityCreateManyInput[] = [];
  const add = (m: { id: string } | undefined, provider: string, linkedVia: string, daysAgo: number, subject?: string) => m?.id && !identities.some((x) => x.membershipId === m.id && x.provider === provider) && identities.push({ orgId, membershipId: m.id, provider, subject: subject ?? `${provider}-${stableId(orgId, provider, m.id).slice(0, 16)}`, linkedVia, lastLoginAt: ago(Math.max(0, daysAgo - 1), 2), createdAt: ago(daysAgo) });
  const personas = w?.personas ?? {};
  // Persona links have readable subjects, so the local mock provider can sign in as them (tests/e2e/sso.spec.ts).
  add({ id: personas.teacher }, "classlink", "external_id", 18, "cl-daniel-carter");
  add({ id: personas.student }, "classlink", "external_id", 17, "cl-adam-nasser");
  add({ id: personas.counselor }, "microsoft", "email", 16, "ms-sarah-ahmed");
  add({ id: personas.parent }, "uaepass", "email", 12, "uaepass-rania-nasser");
  staff.slice(0, 26).forEach((m, i) => add(m, "classlink", "external_id", 20 - (i % 14)));
  students.slice(0, 40).forEach((m, i) => add(m, "classlink", "external_id", 19 - (i % 12)));
  parents.slice(0, 9).forEach((m, i) => add(m, i % 3 === 0 ? "google" : "uaepass", "email", 13 - i));
  await db.ssoIdentity.createMany({ data: identities.filter((x) => x.membershipId), skipDuplicates: true });

  const methods = ["classlink", "classlink", "classlink", "classlink", "password", "password", "google", "magic_link", "uaepass", "microsoft"];
  const events: Prisma.AuditEventCreateManyInput[] = [];
  const pick = <T,>(list: T[]) => list[Math.floor(r() * list.length)];
  for (let d = 13; d >= 0; d--) {
    const perDay = 6 + Math.floor(r() * 6);
    for (let k = 0; k < perDay; k++) {
      const method = pick(methods);
      const pool = method === "uaepass" || method === "magic_link" || method === "google" ? parents : method === "classlink" ? [...staff, ...students] : staff;
      const m = pick(pool);
      if (!m) continue;
      // School hours in Dubai (07:00 to 16:00), never in the future.
      const when = at(-d, 7 + Math.floor(r() * 9), Math.floor(r() * 60), now);
      if (when.getTime() > now.getTime()) continue;
      events.push({ orgId, actorId: m.id, actorUserId: m.userId, action: "auth.sign_in", entityType: "Membership", entityId: m.id, meta: { method }, createdAt: when });
    }
  }
  events.push({ orgId, action: "auth.sign_in_refused", entityType: "SignIn", meta: { method: "classlink", code: "WRONG_TENANT" }, createdAt: ago(9, 4) });
  events.push({ orgId, action: "auth.sign_in_refused", entityType: "SignIn", meta: { method: "google", code: "NOT_PROVISIONED" }, createdAt: ago(5, 2) });
  const resetParent = parents[3];
  if (resetParent) {
    events.push({ orgId, actorId: resetParent.id, actorUserId: resetParent.userId, action: "auth.password_reset", entityType: "Membership", entityId: resetParent.id, meta: { sessionsEnded: true }, createdAt: ago(3, 5) });
    events.push({ orgId, actorId: resetParent.id, actorUserId: resetParent.userId, action: "auth.sign_in", entityType: "Membership", entityId: resetParent.id, meta: { method: "password" }, createdAt: ago(3, 4.9) });
  }
  for (const x of identities.slice(0, 6)) events.push({ orgId, actorId: x.membershipId, action: "auth.sso_linked", entityType: "Membership", entityId: x.membershipId, meta: { method: x.provider, linkedVia: x.linkedVia, created: false }, createdAt: x.createdAt });
  await db.auditEvent.createMany({ data: events });
  log(`rostering: sign-in options, 1 roster connection with ${links.length} links and ${history.length} runs, ${identities.length} linked sign-ins, ${events.length} sign-in events`);
}
