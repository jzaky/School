// Demo data for Integrations: two API keys (one in use, one revoked; nobody holds the keys, only random
// hashes are stored) and a nightly sync source that reads the sample student information system export
// served by this app (/api/v1/samples/sis-students.csv) with a column mapping, plus a few weeks of run
// history. Dates are relative to now. The source's slot for today is marked done, so the scheduler does not
// run it on its own in the demo; "Run now" works and imports three fictional students.
import type { PrismaClient } from "@prisma/client";
import type { SeedWorld } from "./demo";
import { generateApiKey } from "../../src/server/integrations/key-format";
import { localParts } from "../../src/lib/integrations/schedule";
import { SIS_STUDENTS_MAPPING } from "../../src/lib/integrations/samples";

const DAY = 86_400_000;

export async function seedIntegrations(w: SeedWorld) {
  await seedIntegrationsData(w.db, w.orgId, w.now, w.log);
}

export async function seedIntegrationsData(db: PrismaClient, orgId: string, now: Date, log: (m: string) => void = () => {}) {
  if ((await db.syncSource.count({ where: { orgId } })) > 0) return;
  const persona = await db.demoPersona.findFirst({ where: { orgId, key: "admin" } });
  const admin = persona?.membershipId ?? (await db.membership.findFirst({ where: { orgId, roles: { some: { role: { key: "school_admin" } } } } }))?.id;
  if (!admin) return;
  const ago = (days: number, hours = 0) => new Date(now.getTime() - days * DAY - hours * 3_600_000);

  const live = generateApiKey();
  await db.apiKey.create({
    data: { orgId, label: "Student information system (nightly)", prefix: live.prefix, keyHash: live.hash, scopes: ["students:write", "staff:write", "classes:write"], createdById: admin, createdAt: ago(48), lastUsedAt: ago(0, 5), lastAuditAt: ago(0, 5), useCount: 1386, unauditedUses: 0 },
  });
  const old = generateApiKey();
  await db.apiKey.create({
    data: { orgId, label: "Attendance kiosk pilot", prefix: old.prefix, keyHash: old.hash, scopes: ["students:read", "attendance:write"], createdById: admin, createdAt: ago(120), lastUsedAt: ago(62), lastAuditAt: ago(62), useCount: 214, revokedAt: ago(60), revokedById: admin },
  });

  const base = (process.env.APP_URL || process.env.AUTH_URL || "http://localhost:3000").replace(/\/+$/, "");
  const org = await db.organization.findUnique({ where: { id: orgId }, select: { timezone: true } });
  const today = localParts(now, org?.timezone ?? "Asia/Dubai").date;
  const source = await db.syncSource.create({
    data: {
      orgId,
      name: "Nightly student export",
      kind: "students",
      url: `${base}/api/v1/samples/sis-students.csv`,
      authType: "NONE",
      mapping: SIS_STUDENTS_MAPPING,
      schedule: "DAILY",
      hour: 4,
      enabled: true,
      lastSlot: `d:${today}`,
      lastRunAt: ago(0, 6),
      lastStatus: "SUCCEEDED",
      createdById: admin,
      createdAt: ago(21),
    },
  });
  // Three weeks of nightly runs: the first added the students, one night the export had a bad row.
  const runs = Array.from({ length: 21 }, (_, i) => 20 - i).map((d) => {
    const partial = d === 9;
    const first = d === 20;
    const slotDate = localParts(ago(d), org?.timezone ?? "Asia/Dubai").date;
    const started = ago(d, 6);
    return {
      orgId,
      sourceId: source.id,
      slot: `d:${slotDate}`,
      trigger: "SCHEDULE",
      status: partial ? "PARTIAL" : "SUCCEEDED",
      startedAt: started,
      finishedAt: new Date(started.getTime() + 4000),
      total: 3,
      created: first ? 3 : 0,
      updated: first ? 0 : partial ? 2 : 3,
      unchanged: 0,
      failed: partial ? 1 : 0,
      actorId: admin,
    };
  });
  runs.push({ orgId, sourceId: source.id, slot: `m:${ago(14, 3).toISOString()}`, trigger: "MANUAL", status: "SUCCEEDED", startedAt: ago(14, 3), finishedAt: new Date(ago(14, 3).getTime() + 3000), total: 3, created: 0, updated: 3, unchanged: 0, failed: 0, actorId: admin });
  await db.syncRun.createMany({ data: runs, skipDuplicates: true });
  log("integrations: 2 API keys, 1 sync source with run history");
}
