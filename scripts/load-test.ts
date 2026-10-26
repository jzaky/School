// Load test against the synthetic full-size school (scripts/seed-scale.ts). Never point it at a real school.
// Scenarios, each run at increasing concurrency (default 10, 25, 50, 100 users in flight):
//   report:   report card release. A parent opens home, the child page and the report card PDF.
//   register: morning register. A teacher opens today's registers, opens one register and saves it.
//   fees:     fee due date. A parent opens the fees statement and downloads the latest invoice PDF.
// Every virtual user signs in first through the credentials flow (sign-in throughput is reported separately).
// Each concurrency level uses fresh people, so 4 levels x 250 journeys = 1,000 different parents for "report".
// Usage: npx tsx scripts/load-test.ts --base http://localhost:3149 [--scenarios report,register,fees]
//        [--levels 10,25,50,100] [--journeys 250] [--teachers 120] [--open-registers] [--out results.json]
// Reads people and ids with MIGRATION_DATABASE_URL (owner role, like the seeds). Uses Node's built-in fetch.
import { cpus, totalmem } from "node:os";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { ipFor, percentile, pool, signIn, timedAction, timedGet, type Session, type Timed } from "./lib/http-session";

const arg = (name: string, fallback: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const BASE = arg("base", "http://localhost:3149");
const SCENARIOS = arg("scenarios", "report,register,fees").split(",");
const LEVELS = arg("levels", "10,25,50,100").split(",").map(Number);
const JOURNEYS = Number(arg("journeys", "250"));
const TEACHERS = Number(arg("teachers", "120"));
const OUT = arg("out", "");
const OPEN_REGISTERS = process.argv.includes("--open-registers");
const PASSWORD = process.env.SCALE_PASSWORD ?? "ScaleTest2026!";
const SLUG = "scale-test";

type Parent = { email: string; kidId: string; reportId: string | null; invoiceId: string | null };
type Teacher = { email: string; classId: string; periodNo: number; studentIds: string[] };
type Sample = { step: string; t: Timed };

const dubaiToday = () => new Date(Date.now() + 4 * 3600_000).toISOString().slice(0, 10);

async function people() {
  const db = new PrismaClient({ datasourceUrl: process.env.MIGRATION_DATABASE_URL });
  try {
    const org = await db.organization.findUniqueOrThrow({ where: { slug: SLUG } });
    const orgId = org.id;
    // Parents: one row per family (the primary guardian with an account), with a child who has a released report card.
    const links = await db.guardianLink.findMany({
      where: { orgId, isPrimary: true, guardian: { membershipId: { not: null }, membership: { status: "ACTIVE" } } },
      select: { studentId: true, guardian: { select: { membership: { select: { user: { select: { email: true } }, status: true } } } } },
      orderBy: { id: "asc" },
    });
    const docs = await db.document.findMany({ where: { orgId, source: "GENERATED", visibleToFamily: true }, select: { id: true, studentId: true } });
    const docBy = new Map(docs.map((d) => [d.studentId, d.id]));
    const invoices = await db.invoice.findMany({ where: { orgId, kind: "TAX" }, select: { id: true, accountId: true }, orderBy: { issueDate: "desc" } });
    const profiles = await db.studentFeeProfile.findMany({ where: { orgId }, select: { studentId: true, accountId: true } });
    const invoiceByAccount = new Map<string, string>();
    for (const i of invoices) if (!invoiceByAccount.has(i.accountId)) invoiceByAccount.set(i.accountId, i.id);
    const accountOf = new Map(profiles.map((p) => [p.studentId, p.accountId]));
    const seen = new Set<string>();
    const parents: Parent[] = [];
    for (const l of links) {
      const email = l.guardian.membership?.user.email;
      if (!email || seen.has(email) || email === "parent@parents.scale.example") continue;
      seen.add(email);
      const acc = accountOf.get(l.studentId);
      parents.push({ email, kidId: l.studentId, reportId: docBy.get(l.studentId) ?? null, invoiceId: acc ? (invoiceByAccount.get(acc) ?? null) : null });
    }
    // Teachers: homeroom tutors take the daily register, others the first lesson of the day.
    const year = await db.academicYear.findFirstOrThrow({ where: { orgId, isCurrent: true } });
    const today = new Date(`${dubaiToday()}T12:00:00Z`).getUTCDay();
    const homerooms = await db.schoolClass.findMany({ where: { orgId, academicYearId: year.id, isHomeroom: true, teacherMembershipId: { not: null } }, select: { id: true, teacherMembershipId: true, enrollments: { where: { status: "ACTIVE" }, select: { studentId: true } } } });
    const slots = await db.timetableSlot.findMany({ where: { orgId, academicYearId: year.id, dayOfWeek: today, teacherMembershipId: { not: null } }, orderBy: { periodNo: "asc" }, select: { classId: true, periodNo: true, teacherMembershipId: true } });
    const members = await db.membership.findMany({ where: { orgId, id: { in: [...new Set([...homerooms.map((h) => h.teacherMembershipId!), ...slots.map((s) => s.teacherMembershipId!)])] } }, select: { id: true, user: { select: { email: true } } } });
    const emailOf = new Map(members.map((m) => [m.id, m.user.email]));
    const teachers: Teacher[] = [];
    const used = new Set<string>();
    for (const h of homerooms) {
      if (used.has(h.teacherMembershipId!)) continue;
      used.add(h.teacherMembershipId!);
      teachers.push({ email: emailOf.get(h.teacherMembershipId!)!, classId: h.id, periodNo: 0, studentIds: h.enrollments.map((e) => e.studentId) });
    }
    const classStudents = new Map<string, string[]>();
    for (const s of slots) {
      if (used.has(s.teacherMembershipId!)) continue;
      used.add(s.teacherMembershipId!);
      if (!classStudents.has(s.classId)) classStudents.set(s.classId, (await db.enrollment.findMany({ where: { orgId, classId: s.classId, status: "ACTIVE" }, select: { studentId: true } })).map((e) => e.studentId));
      teachers.push({ email: emailOf.get(s.teacherMembershipId!)!, classId: s.classId, periodNo: s.periodNo, studentIds: classStudents.get(s.classId)! });
    }
    return { parents, teachers };
  } finally {
    await db.$disconnect();
  }
}

/** Set the synthetic school's register close time to 23:59; returns a function that puts the old time back. */
async function keepRegistersOpen() {
  const db = new PrismaClient({ datasourceUrl: process.env.MIGRATION_DATABASE_URL });
  const org = await db.organization.findUniqueOrThrow({ where: { slug: SLUG } });
  const before = await db.attendanceSettings.findUnique({ where: { orgId: org.id }, select: { closeTime: true } });
  if (!before) {
    await db.$disconnect();
    return null;
  }
  await db.attendanceSettings.update({ where: { orgId: org.id }, data: { closeTime: "23:59" } });
  return async () => {
    await db.attendanceSettings.update({ where: { orgId: org.id }, data: { closeTime: before.closeTime } });
    await db.$disconnect();
  };
}

/** The server action id of saveRegisterAction in the running build (from Next's server reference manifest). */
function saveRegisterActionId(): string | null {
  const p = ".next/server/server-reference-manifest.json";
  if (!existsSync(p)) return null;
  const m = JSON.parse(readFileSync(p, "utf8")) as { node?: Record<string, { exportedName?: string; filename?: string }> };
  for (const [id, v] of Object.entries(m.node ?? {})) if (v.exportedName === "saveRegisterAction" && (v.filename ?? "").includes("attendance/actions")) return id;
  return null;
}

function summarize(samples: Sample[], wallMs: number) {
  const steps = [...new Set(samples.map((s) => s.step))];
  const ok = (t: Timed) => t.status >= 200 && t.status < 400 && !t.error;
  const row = (list: Sample[]) => {
    const ms = list.map((s) => s.t.ms);
    const errors = list.filter((s) => !ok(s.t)).length;
    return { requests: list.length, errors, errorRate: list.length ? errors / list.length : 0, p50: Math.round(percentile(ms, 50)), p95: Math.round(percentile(ms, 95)), p99: Math.round(percentile(ms, 99)), max: Math.round(Math.max(0, ...ms)) };
  };
  return { wallSeconds: +(wallMs / 1000).toFixed(1), requestsPerSecond: +(samples.length / (wallMs / 1000)).toFixed(1), all: row(samples), steps: Object.fromEntries(steps.map((s) => [s, row(samples.filter((x) => x.step === s))])), sampleErrors: samples.filter((s) => !ok(s.t)).slice(0, 3).map((s) => `${s.step} ${s.t.status} ${s.t.error ?? ""}`.slice(0, 160)) };
}

async function signInAll(emails: string[], concurrency: number, offset: number) {
  const sessions = new Map<string, Session>();
  const times: number[] = [];
  let failed = 0;
  const t0 = performance.now();
  await pool(emails, concurrency, async (email, i) => {
    const s0 = performance.now();
    try {
      sessions.set(email, await signIn(BASE, email, PASSWORD, ipFor(offset + i)));
      times.push(performance.now() - s0);
    } catch {
      failed++;
    }
  });
  const wall = performance.now() - t0;
  return { sessions, stats: { users: emails.length, failed, concurrency, wallSeconds: +(wall / 1000).toFixed(1), perSecond: +(emails.length / (wall / 1000)).toFixed(1), p50: Math.round(percentile(times, 50)), p95: Math.round(percentile(times, 95)), p99: Math.round(percentile(times, 99)) } };
}

async function main() {
  const { parents, teachers } = await people();
  const results: Record<string, unknown> = {
    machine: { cpus: cpus().length, cpuModel: cpus()[0]?.model ?? "", memoryGb: Math.round(totalmem() / 2 ** 30), node: process.version },
    base: BASE,
    at: new Date().toISOString(),
    levels: LEVELS,
    journeys: JOURNEYS,
  };
  const log = (m: string) => console.log(`[load] ${m}`);
  log(`machine: ${cpus().length} CPUs (${cpus()[0]?.model ?? ""}), ${Math.round(totalmem() / 2 ** 30)} GB; ${parents.length} parent accounts, ${teachers.length} teachers available`);
  let ipOffset = 1000;

  if (SCENARIOS.includes("report")) {
    const out: Record<string, unknown> = {};
    const pool0 = parents.filter((p) => p.reportId);
    for (const [li, c] of LEVELS.entries()) {
      const group = pool0.slice(li * JOURNEYS, (li + 1) * JOURNEYS);
      if (group.length < JOURNEYS) log(`report: only ${group.length} parents left for concurrency ${c}`);
      const { sessions, stats } = await signInAll(group.map((p) => p.email), 20, ipOffset);
      ipOffset += group.length;
      log(`report c=${c}: signed in ${stats.users - stats.failed}/${stats.users} parents, ${stats.perSecond}/s, p95 ${stats.p95} ms`);
      const samples: Sample[] = [];
      const t0 = performance.now();
      await pool(group, c, async (p) => {
        const s = sessions.get(p.email);
        if (!s) return;
        samples.push({ step: "home", t: await timedGet(BASE, s, "/en/home") });
        samples.push({ step: "child", t: await timedGet(BASE, s, `/en/children/${p.kidId}`) });
        samples.push({ step: "reportCardPdf", t: await timedGet(BASE, s, `/api/documents/${p.reportId}/download`) });
      });
      const sum = summarize(samples, performance.now() - t0);
      out[`c${c}`] = { signIn: stats, ...sum };
      log(`report c=${c}: ${sum.requestsPerSecond} req/s, p50 ${sum.all.p50} ms, p95 ${sum.all.p95} ms, p99 ${sum.all.p99} ms, errors ${(sum.all.errorRate * 100).toFixed(1)}%`);
    }
    results.report = out;
  }

  if (SCENARIOS.includes("register")) {
    const out: Record<string, unknown> = {};
    const actionId = saveRegisterActionId();
    if (!actionId) log("register: saveRegisterAction id not found in .next; saving is skipped");
    // Teachers can only save before the school's close time (15:30 Dubai by default). Outside school hours,
    // --open-registers keeps the synthetic school's registers open until 23:59 for the run, then restores it.
    const restoreClose = OPEN_REGISTERS ? await keepRegistersOpen() : null;
    if (!OPEN_REGISTERS) log("register: saving needs open registers; run before the close time or pass --open-registers");
    const group = teachers.slice(0, TEACHERS);
    const { sessions, stats } = await signInAll(group.map((t) => t.email), 20, ipOffset);
    ipOffset += group.length;
    log(`register: signed in ${stats.users - stats.failed}/${stats.users} teachers, ${stats.perSecond}/s`);
    const date = dubaiToday();
    for (const c of LEVELS) {
      const samples: Sample[] = [];
      const t0 = performance.now();
      await pool(group, c, async (tch) => {
        const s = sessions.get(tch.email);
        if (!s) return;
        samples.push({ step: "todaysRegisters", t: await timedGet(BASE, s, "/en/attendance") });
        const path = `/en/attendance/take?class=${tch.classId}&period=${tch.periodNo}`;
        samples.push({ step: "openRegister", t: await timedGet(BASE, s, path) });
        if (actionId) {
          const marks = tch.studentIds.map((id, i) => ({ studentId: id, code: i % 29 === 7 ? "A" : i % 31 === 3 ? "L" : "P", minutesLate: i % 31 === 3 ? 6 : null }));
          samples.push({ step: "saveRegister", t: await timedAction(BASE, s, path, actionId, [{ ref: { classId: tch.classId, date, periodNo: tch.periodNo }, marks }]) });
        }
      });
      const sum = summarize(samples, performance.now() - t0);
      out[`c${c}`] = sum;
      log(`register c=${c}: ${sum.requestsPerSecond} req/s, p50 ${sum.all.p50} ms, p95 ${sum.all.p95} ms, p99 ${sum.all.p99} ms, errors ${(sum.all.errorRate * 100).toFixed(1)}%`);
    }
    results.register = { signIn: stats, teachers: group.length, ...out };
    if (restoreClose) await restoreClose();
  }

  if (SCENARIOS.includes("fees")) {
    const out: Record<string, unknown> = {};
    const pool0 = parents.filter((p) => p.invoiceId).reverse();
    for (const [li, c] of LEVELS.entries()) {
      const group = pool0.slice(li * JOURNEYS, (li + 1) * JOURNEYS);
      const { sessions, stats } = await signInAll(group.map((p) => p.email), 20, ipOffset);
      ipOffset += group.length;
      const samples: Sample[] = [];
      const t0 = performance.now();
      await pool(group, c, async (p) => {
        const s = sessions.get(p.email);
        if (!s) return;
        samples.push({ step: "statement", t: await timedGet(BASE, s, "/en/fees") });
        samples.push({ step: "invoicePdf", t: await timedGet(BASE, s, `/api/fees/invoices/${p.invoiceId}/pdf`) });
      });
      const sum = summarize(samples, performance.now() - t0);
      out[`c${c}`] = { signIn: stats, ...sum };
      log(`fees c=${c}: ${sum.requestsPerSecond} req/s, p50 ${sum.all.p50} ms, p95 ${sum.all.p95} ms, p99 ${sum.all.p99} ms, errors ${(sum.all.errorRate * 100).toFixed(1)}%`);
    }
    results.fees = out;
  }

  if (OUT) writeFileSync(OUT, JSON.stringify(results, null, 2));
  log("done");
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
