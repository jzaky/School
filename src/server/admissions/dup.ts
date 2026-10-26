// Duplicate detection and sibling matching for applications.
// A duplicate is another application or a student in the same school with the same Emirates ID, or the same English
// name and date of birth. Flags are shown to staff only: a family never learns whether another family applied.
import type { Prisma } from "@prisma/client";
import type { Tx } from "@/server/db";
import { decryptText } from "./secure";
import { normName } from "./rules";

export type DupInput = {
  id: string;
  emiratesIdHash: string | null;
  emiratesIdLast4: string | null;
  eidDigits: string | null;
  nameDobKey: string | null;
  firstNameEn: string;
  lastNameEn: string;
  dateOfBirth: Date | null;
};

/** Flags like "eid:application:<id>", "namedob:student:<id>". Closed (withdrawn or declined) applications count too. */
export async function findDuplicates(tx: Tx, orgId: string, a: DupInput): Promise<string[]> {
  const flags = new Set<string>();
  const or: Prisma.AdmissionApplicationWhereInput[] = [];
  if (a.emiratesIdHash) or.push({ emiratesIdHash: a.emiratesIdHash });
  if (a.nameDobKey) or.push({ nameDobKey: a.nameDobKey });
  if (or.length) {
    const apps = await tx.admissionApplication.findMany({ where: { orgId, id: { not: a.id }, stage: { not: "DRAFT" }, OR: or }, select: { id: true, emiratesIdHash: true, nameDobKey: true }, take: 20 });
    for (const x of apps) {
      if (a.emiratesIdHash && x.emiratesIdHash === a.emiratesIdHash) flags.add(`eid:application:${x.id}`);
      else if (a.nameDobKey && x.nameDobKey === a.nameDobKey) flags.add(`namedob:application:${x.id}`);
    }
  }
  // Students keep the Emirates ID encrypted with a random IV, so compare the few with the same last digits.
  if (a.eidDigits && a.emiratesIdLast4) {
    const candidates = await tx.student.findMany({ where: { orgId, emiratesIdLast4: a.emiratesIdLast4, emiratesIdEnc: { not: null } }, select: { id: true, emiratesIdEnc: true }, take: 50 });
    for (const s of candidates) if (decryptText(s.emiratesIdEnc)?.replace(/\D/g, "") === a.eidDigits) flags.add(`eid:student:${s.id}`);
  }
  if (a.dateOfBirth && a.firstNameEn && a.lastNameEn) {
    const sameDay = await tx.student.findMany({ where: { orgId, dateOfBirth: a.dateOfBirth }, select: { id: true, firstNameEn: true, lastNameEn: true }, take: 200 });
    const f = normName(a.firstNameEn);
    const l = normName(a.lastNameEn);
    for (const s of sameDay) if (normName(s.firstNameEn) === f && normName(s.lastNameEn) === l && !flags.has(`eid:student:${s.id}`)) flags.add(`namedob:student:${s.id}`);
  }
  return [...flags];
}

export type ParsedFlag = { kind: "eid" | "namedob"; target: "application" | "student"; id: string };

export function parseFlags(flags: string[]): ParsedFlag[] {
  return flags
    .map((f) => f.split(":"))
    .filter((p) => p.length === 3 && (p[0] === "eid" || p[0] === "namedob") && (p[1] === "application" || p[1] === "student"))
    .map(([kind, target, id]) => ({ kind: kind as ParsedFlag["kind"], target: target as ParsedFlag["target"], id }));
}

/**
 * Current students who are this child's siblings: the family typed their student number, or a guardian on the
 * application has the same email as a guardian already linked to a student. Staff confirm the list.
 */
export async function matchSiblings(tx: Tx, orgId: string, input: { siblings: Array<{ name: string; studentNo?: string | null }>; guardianEmails: string[] }): Promise<string[]> {
  const ids = new Set<string>();
  const nos = input.siblings.map((s) => (s.studentNo ?? "").trim()).filter(Boolean);
  if (nos.length) {
    const rows = await tx.student.findMany({ where: { orgId, status: "ACTIVE", studentNo: { in: nos, mode: "insensitive" } }, select: { id: true, firstNameEn: true, firstNameAr: true, studentNo: true } });
    for (const r of rows) {
      const typed = input.siblings.find((s) => (s.studentNo ?? "").trim().toLowerCase() === r.studentNo.toLowerCase());
      const name = normName(typed?.name);
      // The typed name must contain the student's first name, so a mistyped number does not link a stranger.
      if (typed && (name.includes(normName(r.firstNameEn)) || (r.firstNameAr && name.includes(normName(r.firstNameAr))))) ids.add(r.id);
    }
  }
  const emails = [...new Set(input.guardianEmails.map((e) => e.trim().toLowerCase()).filter(Boolean))];
  if (emails.length) {
    const links = await tx.guardianLink.findMany({ where: { orgId, guardian: { email: { in: emails, mode: "insensitive" } }, student: { status: "ACTIVE" } }, select: { studentId: true }, take: 20 });
    for (const l of links) ids.add(l.studentId);
  }
  return [...ids];
}
