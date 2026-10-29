import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { disconnectAll, ownerPrisma, withTenant } from "@aegis/db";
import { registerUser } from "../src/identity/auth.js";
import { exportCheckpointPublicKey, writeCheckpoint } from "../src/evidence/ledger.js";
import { setupSectorLab } from "../src/validation/sector-lab.js";
import { runImpact, type ImpactRun } from "../src/validation/impact.js";

const verifier = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "scripts", "verify-evidence.mjs");
const verify = (folder: string) => {
  try {
    execFileSync("node", [verifier, folder], { encoding: "utf8" });
    return true;
  } catch {
    return false;
  }
};

describe("impact: the same requests without and with AEGIS", () => {
  let userId: string;
  let orgId: string;
  let run: ImpactRun;
  beforeAll(async () => {
    userId = (await registerUser({ email: `impact-${Date.now().toString(36)}@test.aegis.local`, name: "Impact", password: "CorrectHorse1Battery" })).id;
    orgId = (await setupSectorLab(userId)).id;
    run = await runImpact(orgId);
  }, 240_000);
  afterAll(async () => {
    await ownerPrisma().organization.delete({ where: { id: orgId } }).catch(() => undefined);
    await ownerPrisma().$executeRawUnsafe(`DELETE FROM evidence_checkpoints WHERE org_id = $1::uuid`, orgId).catch(() => undefined);
    await ownerPrisma().user.delete({ where: { id: userId } }).catch(() => undefined);
    await disconnectAll();
  });

  it("no harmful action or attack reaches the system with AEGIS, and every legitimate one still does", () => {
    const t = run.totals;
    expect(t.harmful.cases).toBeGreaterThan(10);
    expect(t.harmful.executedWithout).toBe(t.harmful.cases);
    expect(t.harmful.executedWith).toBe(0);
    expect(t.harmful.valueWith).toEqual({});
    expect(t.attacks.succeededWith).toBe(0);
    expect(t.needsReview.executedWith).toBe(0);
    expect(t.needsReview.heldForPerson).toBe(t.needsReview.cases);
    expect(t.legitimate.executedWith).toBe(t.legitimate.executedWithout);
    expect(t.fieldsReleased.with).toBeLessThan(t.fieldsReleased.without);
  });

  it("the system refuses forged and reused permissions, and the evidence ledger verifies", () => {
    const t = run.totals;
    expect(t.bypass.refused).toBe(t.bypass.attempts);
    expect(t.replay.refused).toBe(t.replay.attempts);
    expect(t.evidence.recordsWith).toBeGreaterThan(run.cases.length);
    expect(t.evidence.ledgerValid).toBe(true);
  });

  it("an exported bundle verifies with the standalone verifier, and an edited copy does not", async () => {
    const pem = exportCheckpointPublicKey();
    expect(pem, "tests need EVIDENCE_SIGNING_KEY").toBeTruthy();
    const { events, cp } = await withTenant(orgId, async (db) => {
      const cp = (await writeCheckpoint(db, orgId))!;
      const events = await db.evidenceEvent.findMany({ where: { orgId, seq: { gte: BigInt(run.evidenceRange.fromSeq), lte: cp.throughSeq } }, orderBy: { seq: "asc" } });
      return { events, cp };
    });
    const dir = mkdtempSync(join(tmpdir(), "aegis-bundle-"));
    try {
      const lines = events.map((e) => JSON.stringify({ ...e, seq: e.seq.toString(), occurredAt: e.occurredAt.toISOString() }));
      writeFileSync(join(dir, "events.jsonl"), lines.join("\n") + "\n");
      writeFileSync(join(dir, "checkpoint.json"), JSON.stringify({ throughSeq: cp.throughSeq.toString(), hash: cp.hash, signature: cp.signature, keyId: cp.keyId }));
      writeFileSync(join(dir, "public-key.pem"), pem!);
      expect(verify(dir)).toBe(true);
      const i = lines.findIndex((l) => l.includes('"type":"gateway.decision.deny"'));
      writeFileSync(join(dir, "events.jsonl"), lines.map((l, j) => (j === i ? l.replace('"result":"deny"', '"result":"allow"') : l)).join("\n") + "\n");
      expect(verify(dir)).toBe(false);
      writeFileSync(join(dir, "events.jsonl"), lines.filter((_, j) => j !== 3).join("\n") + "\n");
      expect(verify(dir)).toBe(false);
      expect(readFileSync(join(dir, "public-key.pem"), "utf8")).toMatch(/BEGIN PUBLIC KEY/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
