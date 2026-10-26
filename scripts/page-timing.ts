// Server response times for the main pages, per role, against the synthetic full-size school (scripts/seed-scale.ts).
// Signs in each test persona through the credentials flow, warms each page once, then requests it RUNS times in a
// row and reports p50, p95 and max of the time to the last byte. Requests are sequential: this measures the cost
// of one page at full data size, not throughput (scripts/load-test.ts does that).
// Usage: npx tsx scripts/page-timing.ts --base http://localhost:3149 --runs 7 --label after [--out file.json]
// Reads ids (classes, children, documents, returns) from the database with MIGRATION_DATABASE_URL.
import { writeFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { ipFor, percentile, signIn, timedGet, type Session } from "./lib/http-session";

const arg = (name: string, fallback: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const BASE = arg("base", "http://localhost:3149");
const RUNS = Number(arg("runs", "7"));
const LABEL = arg("label", "run");
const OUT = arg("out", "");
const PASSWORD = process.env.SCALE_PASSWORD ?? "ScaleTest2026!";
const SLUG = "scale-test";

type Page = { role: string; name: string; path: string };

async function discover(): Promise<Page[]> {
  const db = new PrismaClient({ datasourceUrl: process.env.MIGRATION_DATABASE_URL });
  try {
    const org = await db.organization.findUniqueOrThrow({ where: { slug: SLUG } });
    const orgId = org.id;
    const year = await db.academicYear.findFirstOrThrow({ where: { orgId, isCurrent: true } });
    const teacher = await db.membership.findFirstOrThrow({ where: { orgId, user: { email: "teacher@staff.scale.example" } } });
    const homeroom = await db.schoolClass.findFirst({ where: { orgId, academicYearId: year.id, isHomeroom: true, teacherMembershipId: teacher.id } });
    const today = new Date(Date.now() + 4 * 3600_000).getUTCDay();
    const lesson = await db.timetableSlot.findFirst({ where: { orgId, academicYearId: year.id, teacherMembershipId: teacher.id, dayOfWeek: today >= 1 && today <= 5 ? today : 1 }, orderBy: { periodNo: "asc" } });
    const parent = await db.membership.findFirstOrThrow({ where: { orgId, user: { email: "parent@parents.scale.example" } }, include: { guardian: { include: { links: { include: { student: true } } } } } });
    const kids = (parent.guardian?.links ?? []).map((l) => l.student).sort((a, b) => a.gradeLevel - b.gradeLevel);
    const report = await db.document.findFirst({ where: { orgId, studentId: { in: kids.map((k) => k.id) }, source: "GENERATED", visibleToFamily: true }, orderBy: { createdAt: "desc" } });
    const census = await db.govReturn.findFirst({ where: { orgId, kind: "CENSUS" } });
    const attendanceReturn = await db.govReturn.findFirst({ where: { orgId, kind: "ATTENDANCE" } });
    const pages: Page[] = [
      { role: "admin", name: "Students list", path: "/en/students" },
      { role: "admin", name: "Students list, page 20", path: "/en/students?page=20" },
      { role: "admin", name: "Students search", path: "/en/students?q=ham" },
      { role: "admin", name: "People: students", path: "/en/admin/people?tab=students" },
      { role: "admin", name: "People: families", path: "/en/admin/people?tab=families" },
      { role: "admin", name: "People: staff", path: "/en/admin/people?tab=staff" },
      { role: "admin", name: "Admissions board", path: "/en/admissions" },
      { role: "admin", name: "Finance overview", path: "/en/finance" },
      { role: "admin", name: "Attendance reports", path: "/en/attendance/reports" },
      ...(census ? [{ role: "admin", name: "Government census return", path: `/en/admin/government/${census.id}` }] : []),
      ...(attendanceReturn ? [{ role: "admin", name: "Government attendance return", path: `/en/admin/government/${attendanceReturn.id}` }] : []),
      { role: "teacher", name: "Today's registers", path: "/en/attendance" },
      ...(homeroom ? [{ role: "teacher", name: "Take register (homeroom)", path: `/en/attendance/take?class=${homeroom.id}&period=0` }] : []),
      ...(lesson ? [{ role: "teacher", name: "Take register (lesson)", path: `/en/attendance/take?class=${lesson.classId}&period=${lesson.periodNo}` }] : []),
      ...(lesson ? [{ role: "teacher", name: "Gradebook", path: `/en/grades?class=${lesson.classId}` }] : []),
      { role: "parent", name: "Parent home", path: "/en/home" },
      ...kids.map((k) => ({ role: "parent", name: `Child page (${k.gradeLevel === -1 ? "KG1" : k.gradeLevel === 0 ? "KG2" : `Grade ${k.gradeLevel}`})`, path: `/en/children/${k.id}` })),
      { role: "parent", name: "Fees statement", path: "/en/fees" },
      ...(report ? [{ role: "parent", name: "Report card PDF", path: `/api/documents/${report.id}/download` }] : []),
      { role: "student", name: "Student home", path: "/en/home" },
      { role: "student", name: "Subjects", path: "/en/subjects" },
      { role: "student", name: "Pathways", path: "/en/career/pathways" },
      { role: "principal", name: "Principal home (dashboard)", path: "/en/home" },
      { role: "principal", name: "Analytics", path: "/en/analytics" },
      { role: "dsl", name: "Cases", path: "/en/cases" },
      { role: "dsl", name: "DSL home", path: "/en/home" },
    ];
    return pages;
  } finally {
    await db.$disconnect();
  }
}

const EMAILS: Record<string, string> = {
  admin: "admin@staff.scale.example",
  principal: "principal@staff.scale.example",
  teacher: "teacher@staff.scale.example",
  dsl: "dsl@staff.scale.example",
  parent: "parent@parents.scale.example",
  student: "student@students.scale.example",
};

async function main() {
  const pages = await discover();
  const sessions = new Map<string, Session>();
  let n = 1;
  for (const role of Object.keys(EMAILS)) sessions.set(role, await signIn(BASE, EMAILS[role], PASSWORD, ipFor(n++)));
  const results: Array<{ role: string; name: string; path: string; status: number; bytes: number; p50: number; p95: number; max: number; runs: number[] }> = [];
  for (const p of pages) {
    const s = sessions.get(p.role)!;
    const warm = await timedGet(BASE, s, p.path);
    const runs: number[] = [];
    let status = warm.status;
    let bytes = warm.bytes;
    for (let i = 0; i < RUNS; i++) {
      const res = await timedGet(BASE, s, p.path);
      runs.push(res.ms);
      status = res.status;
      bytes = res.bytes;
    }
    const row = { role: p.role, name: p.name, path: p.path, status, bytes, p50: Math.round(percentile(runs, 50)), p95: Math.round(percentile(runs, 95)), max: Math.round(Math.max(...runs)), runs: runs.map(Math.round) };
    results.push(row);
    console.log(`${p.role.padEnd(9)} ${p.name.padEnd(32)} ${String(status).padEnd(4)} p50 ${String(row.p50).padStart(6)} ms  p95 ${String(row.p95).padStart(6)} ms  ${Math.round(bytes / 1024)} KB`);
  }
  const out = { label: LABEL, base: BASE, runs: RUNS, at: new Date().toISOString(), results };
  if (OUT) writeFileSync(OUT, JSON.stringify(out, null, 2));
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
