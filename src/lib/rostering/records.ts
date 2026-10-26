// Roster records in one shape, whatever the source: OneRoster 1.1 or 1.2 over REST, OneRoster CSV files, or the
// Clever data API. The staging table keeps these; the planner (src/server/rostering/plan.ts) applies them.
// Pure: unit-tested with fixture payloads.
import { createHash } from "node:crypto";
import { normalizeFeedRole, normalizeGradeCode } from "./options";

export type Status = "active" | "tobedeleted";

export type RUser = {
  id: string;
  status: Status;
  role: string | null;
  givenName: string;
  familyName: string;
  email: string | null;
  /** Student number or staff number in the school's own system. */
  identifier: string | null;
  grades: string[];
  orgIds: string[];
  /** Linked people: a student's parents, a parent's children. */
  agentIds: string[];
  phone: string | null;
  enabled: boolean;
  /** Clever contacts: the relationship to each student, by student id. */
  relationships?: Record<string, string>;
};

export type RClass = {
  id: string;
  status: Status;
  title: string;
  classCode: string | null;
  homeroom: boolean;
  grades: string[];
  subjects: string[];
  subjectCodes: string[];
  courseId: string | null;
  orgId: string | null;
  termIds: string[];
  location: string | null;
};

export type REnrollment = { id: string; status: Status; userId: string; classId: string; role: string | null; primary: boolean };
export type ROrg = { id: string; status: Status; name: string; type: string | null; identifier: string | null };
export type RSession = { id: string; status: Status; title: string; type: string | null; startDate: string | null; endDate: string | null };
export type RDemographic = { id: string; status: Status; birthDate: string | null; sex: string | null };
export type RCourse = { id: string; status: Status; title: string; courseCode: string | null; subjects: string[]; subjectCodes: string[] };

export type RecordKind = "org" | "session" | "user" | "class" | "enrollment" | "demographic" | "course";
export type AnyRecord = RUser | RClass | REnrollment | ROrg | RSession | RDemographic | RCourse;
export type Staged = { kind: RecordKind; externalId: string; data: AnyRecord; hash: string };

const str = (v: unknown, max = 200): string | null => {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s ? s.slice(0, max) : null;
};
const ref = (v: unknown): string | null => (v && typeof v === "object" ? str((v as { sourcedId?: unknown }).sourcedId) : str(v));
const refs = (v: unknown): string[] => (Array.isArray(v) ? v.map(ref).filter((x): x is string => !!x) : typeof v === "string" ? splitList(v) : []);
const list = (v: unknown): string[] => (Array.isArray(v) ? v.map((x) => str(x)).filter((x): x is string => !!x) : typeof v === "string" ? splitList(v) : []);
export const splitList = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);
const status = (v: unknown): Status => (String(v ?? "active").toLowerCase() === "tobedeleted" ? "tobedeleted" : "active");
const email = (v: unknown) => {
  const e = str(v, 200)?.toLowerCase() ?? null;
  return e && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e) ? e : null;
};
const grades = (v: unknown) => [...new Set(list(v).map(normalizeGradeCode).filter((g): g is string => !!g))];
const bool = (v: unknown, d: boolean) => (v === true || v === "true" || v === "TRUE" ? true : v === false || v === "false" || v === "FALSE" ? false : d);
const dateOnly = (v: unknown) => {
  const s = str(v, 40);
  return s && /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null;
};

/** Stable hash of the fields that matter, so an unchanged record is skipped on the next sync. */
export function recordHash(data: AnyRecord): string {
  const sorted = (x: unknown): unknown => (Array.isArray(x) ? x.map(sorted) : x && typeof x === "object" ? Object.fromEntries(Object.entries(x as object).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, sorted(v)])) : x);
  return createHash("sha256").update(JSON.stringify(sorted(data))).digest("hex").slice(0, 32);
}

const staged = (kind: RecordKind, data: AnyRecord): Staged => ({ kind, externalId: data.id, data, hash: recordHash(data) });

// ---------------------------------------------------------------------------
// OneRoster (REST JSON and CSV rows share the field names; CSV uses *SourcedId(s) columns)
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>;

export function oneRosterUser(u: Row): Staged | null {
  const id = str(u.sourcedId);
  if (!id) return null;
  // OneRoster 1.2: roles[] with a primary role; 1.1: role.
  const roles = Array.isArray(u.roles) ? (u.roles as Row[]) : [];
  const primary = roles.find((r) => String(r.roleType ?? "").toLowerCase() === "primary") ?? roles[0];
  const role = normalizeFeedRole(u.role ?? primary?.role);
  const orgIds = [...new Set([...refs(u.orgs), ...refs(u.orgSourcedIds), ...roles.map((r) => ref(r.org)).filter((x): x is string => !!x), ...(ref(u.primaryOrg) ? [ref(u.primaryOrg)!] : [])])];
  const user: RUser = {
    id,
    status: status(u.status),
    role,
    givenName: str(u.preferredGivenName) ?? str(u.givenName) ?? "",
    familyName: str(u.preferredFamilyName) ?? str(u.familyName) ?? "",
    email: email(u.email),
    identifier: str(u.identifier, 40),
    grades: grades(u.grades),
    orgIds,
    agentIds: [...new Set([...refs(u.agents), ...refs(u.agentSourcedIds)])],
    phone: str(u.phone, 40) ?? str(u.sms, 40),
    enabled: bool(u.enabledUser, true),
  };
  return staged("user", user);
}

export function oneRosterClass(c: Row): Staged | null {
  const id = str(c.sourcedId);
  if (!id) return null;
  const cls: RClass = {
    id,
    status: status(c.status),
    title: str(c.title) ?? str(c.classCode) ?? id,
    classCode: str(c.classCode, 60),
    homeroom: String(c.classType ?? "").toLowerCase() === "homeroom",
    grades: grades(c.grades),
    subjects: list(c.subjects),
    subjectCodes: list(c.subjectCodes),
    courseId: ref(c.course) ?? str(c.courseSourcedId),
    orgId: ref(c.school) ?? str(c.schoolSourcedId),
    termIds: [...refs(c.terms), ...refs(c.termSourcedIds)],
    location: str(c.location, 60),
  };
  return staged("class", cls);
}

export function oneRosterEnrollment(e: Row): Staged | null {
  const id = str(e.sourcedId);
  const userId = ref(e.user) ?? str(e.userSourcedId);
  const classId = ref(e.class) ?? str(e.classSourcedId);
  if (!id || !userId || !classId) return null;
  return staged("enrollment", { id, status: status(e.status), userId, classId, role: normalizeFeedRole(e.role), primary: bool(e.primary, false) });
}

export function oneRosterOrg(o: Row): Staged | null {
  const id = str(o.sourcedId);
  if (!id) return null;
  return staged("org", { id, status: status(o.status), name: str(o.name) ?? id, type: str(o.type, 40), identifier: str(o.identifier, 60) });
}

export function oneRosterSession(s: Row): Staged | null {
  const id = str(s.sourcedId);
  if (!id) return null;
  return staged("session", { id, status: status(s.status), title: str(s.title) ?? id, type: str(s.type, 40), startDate: dateOnly(s.startDate), endDate: dateOnly(s.endDate) });
}

export function oneRosterDemographic(d: Row): Staged | null {
  const id = str(d.sourcedId);
  if (!id) return null;
  const sex = str(d.sex, 20)?.toLowerCase() ?? null;
  return staged("demographic", { id, status: status(d.status), birthDate: dateOnly(d.birthDate), sex: sex === "male" || sex === "female" ? sex : null });
}

export function oneRosterCourse(c: Row): Staged | null {
  const id = str(c.sourcedId);
  if (!id) return null;
  return staged("course", { id, status: status(c.status), title: str(c.title) ?? id, courseCode: str(c.courseCode, 60), subjects: list(c.subjects), subjectCodes: list(c.subjectCodes) });
}

// ---------------------------------------------------------------------------
// Clever data API v3.0
// ---------------------------------------------------------------------------

/** One Clever user (v3.0 /users). Multi-role users are read by their first role, in this order. */
export function cleverUser(u: Row): Staged | null {
  const id = str(u.id);
  if (!id) return null;
  const roles = (u.roles ?? {}) as Record<string, Row>;
  const key = ["student", "teacher", "staff", "district_admin", "contact"].find((k) => roles[k]);
  if (!key) return null;
  const r = roles[key] ?? {};
  const name = (u.name ?? {}) as Row;
  const student = key === "student";
  const rels = Array.isArray(r.student_relationships) ? (r.student_relationships as Row[]) : [];
  const relationships: Record<string, string> = {};
  for (const rel of rels) {
    const sid = str(rel.student);
    if (sid) relationships[sid] = str(rel.relationship, 40) ?? str(rel.type, 40) ?? "";
  }
  const user: RUser = {
    id,
    status: "active",
    role: key === "contact" ? "relative" : key === "district_admin" ? "administrator" : normalizeFeedRole(key),
    givenName: str(name.first) ?? "",
    familyName: str(name.last) ?? "",
    email: email(u.email),
    identifier: str(student ? (r.student_number ?? r.sis_id) : (r.teacher_number ?? r.staff_id ?? r.sis_id), 40),
    grades: student ? grades(r.grade) : [],
    orgIds: [...new Set([...list(r.schools), ...(str(r.school) ? [str(r.school)!] : [])])],
    agentIds: Object.keys(relationships),
    phone: str(r.phone, 40),
    enabled: true,
    ...(key === "contact" ? { relationships } : {}),
  };
  return staged("user", user);
}

/** One Clever section becomes a class plus an enrollment per teacher and student. */
export function cleverSection(s: Row): Staged[] {
  const id = str(s.id);
  if (!id) return [];
  const teachers = [...new Set([...(str(s.teacher) ? [str(s.teacher)!] : []), ...list(s.teachers)])];
  const students = [...new Set(list(s.students))];
  const cls: RClass = {
    id,
    status: "active",
    title: str(s.name) ?? id,
    classCode: str(s.sis_id, 60) ?? str(s.section_number, 60),
    homeroom: String(s.subject ?? "").toLowerCase() === "homeroom/advisory",
    grades: grades(s.grade),
    subjects: str(s.subject) ? [str(s.subject)!] : [],
    subjectCodes: [],
    courseId: str(s.course, 60),
    orgId: str(s.school),
    termIds: str(s.term_id) ? [str(s.term_id)!] : [],
    location: str(s.room, 60),
  };
  const out: Staged[] = [staged("class", cls)];
  teachers.forEach((t, i) => out.push(staged("enrollment", { id: `${id}:${t}`, status: "active", userId: t, classId: id, role: "teacher", primary: i === 0 || t === str(s.teacher) })));
  for (const st of students) out.push(staged("enrollment", { id: `${id}:${st}`, status: "active", userId: st, classId: id, role: "student", primary: false }));
  return out;
}

export function cleverSchool(s: Row): Staged | null {
  const id = str(s.id);
  if (!id) return null;
  return staged("org", { id, status: "active", name: str(s.name) ?? id, type: "school", identifier: str(s.school_number, 60) ?? str(s.sis_id, 60) });
}

export function cleverTerm(t: Row): Staged | null {
  const id = str(t.id);
  if (!id) return null;
  return staged("session", { id, status: "active", title: str(t.name) ?? id, type: "term", startDate: dateOnly(t.start_date), endDate: dateOnly(t.end_date) });
}

// ---------------------------------------------------------------------------
// Relationship labels for guardian links
// ---------------------------------------------------------------------------

const RELATIONSHIP_LABELS: Record<string, { en: string; ar: string }> = {
  mother: { en: "Mother", ar: "الأم" },
  father: { en: "Father", ar: "الأب" },
  parent: { en: "Parent", ar: "ولي الأمر" },
  guardian: { en: "Guardian", ar: "ولي الأمر" },
  grandmother: { en: "Grandmother", ar: "الجدة" },
  grandfather: { en: "Grandfather", ar: "الجد" },
  grandparent: { en: "Grandparent", ar: "الجد أو الجدة" },
  aunt: { en: "Aunt", ar: "العمة أو الخالة" },
  uncle: { en: "Uncle", ar: "العم أو الخال" },
  relative: { en: "Relative", ar: "قريب" },
};

export function relationshipLabel(raw: string | null | undefined, role: string | null): { en: string; ar: string } {
  const k = String(raw ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  return RELATIONSHIP_LABELS[k] ?? RELATIONSHIP_LABELS[role ?? "parent"] ?? RELATIONSHIP_LABELS.parent;
}
