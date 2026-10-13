import { generateKeyPairSync, sign } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { makeTestTenant, withTenant, type TestTenant } from "./helpers.js";
import { appendEvidence, checkpointMessage, exportCheckpointPublicKeys, loadKeyRing, verifyChain, verifyCheckpointSignature, writeCheckpoint } from "../src/evidence/ledger.js";

// S9: checkpoints are signed with the current key, verified with the key that signed them, and stay
// verifiable after a rotation as long as the retired public key is kept.
function newKey() {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  return {
    signing: Buffer.from(privateKey.export({ type: "pkcs8", format: "pem" }).toString()).toString("base64"),
    publicB64: Buffer.from(publicKey.export({ type: "spki", format: "pem" }).toString()).toString("base64"),
  };
}

let t: TestTenant;
const oldKey = newKey();
const newer = newKey();

beforeAll(async () => {
  t = await makeTestTenant("sign");
});
afterAll(async () => {
  await t.cleanup();
});

async function addEvent(n: number) {
  await withTenant(t.orgId, (db) => appendEvidence(db, t.ownerCtx, { type: "test.signing", subjectType: "test", subjectId: t.orgId, payload: { n } }));
}

describe("evidence checkpoint signing (S9)", () => {
  it("signs a checkpoint with the current key and verifies it", async () => {
    const ring = loadKeyRing(oldKey.signing, undefined);
    await addEvent(1);
    const cp = await withTenant(t.orgId, (db) => writeCheckpoint(db, t.orgId, ring));
    expect(cp?.keyId).toBe(ring.current!.keyId);
    const v = await withTenant(t.orgId, (db) => verifyChain(db, t.orgId, { ring }), { readOnly: true });
    expect(v.valid).toBe(true);
    expect(v.checkpoints.every((c) => c.valid)).toBe(true);
  });

  it("rejects a tampered signature, a different hash and a different organization", () => {
    const ring = loadKeyRing(oldKey.signing, undefined);
    const keyId = ring.current!.keyId;
    const msgHash = "a".repeat(64);
    const sig = sign(null, checkpointMessage(msgHash, 1n, t.orgId), ring.current!.privateKey).toString("base64");
    expect(verifyCheckpointSignature(msgHash, 1n, t.orgId, sig, keyId, ring)).toBe(true);
    const flipped = Buffer.from(sig, "base64");
    flipped[0] = flipped[0]! ^ 0xff;
    expect(verifyCheckpointSignature(msgHash, 1n, t.orgId, flipped.toString("base64"), keyId, ring)).toBe(false);
    expect(verifyCheckpointSignature("b".repeat(64), 1n, t.orgId, sig, keyId, ring)).toBe(false);
    expect(verifyCheckpointSignature(msgHash, 1n, "00000000-0000-7000-8000-000000000000", sig, keyId, ring)).toBe(false);
  });

  it("after a rotation, old checkpoints verify with the retired public key and new ones with the new key", async () => {
    const rotated = loadKeyRing(newer.signing, oldKey.publicB64);
    await addEvent(2);
    const cp = await withTenant(t.orgId, (db) => writeCheckpoint(db, t.orgId, rotated));
    expect(cp?.keyId).toBe(rotated.current!.keyId);
    const v = await withTenant(t.orgId, (db) => verifyChain(db, t.orgId, { ring: rotated }), { readOnly: true });
    expect(v.valid).toBe(true);
    expect(v.checkpoints).toHaveLength(2);
    const keys = exportCheckpointPublicKeys(rotated);
    expect(keys.map((k) => k.current)).toEqual([true, false]);
  });

  it("a checkpoint whose key is no longer known fails verification instead of being skipped", async () => {
    const forgotten = loadKeyRing(newer.signing, undefined);
    const v = await withTenant(t.orgId, (db) => verifyChain(db, t.orgId, { ring: forgotten }), { readOnly: true });
    expect(v.valid).toBe(false);
    expect(v.reason).toMatch(/checkpoint/);
    expect(v.checkpoints.filter((c) => !c.valid)).toHaveLength(1);
  });

  it("refuses keys that are not Ed25519", () => {
    const { privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
    const ec = Buffer.from(privateKey.export({ type: "pkcs8", format: "pem" }).toString()).toString("base64");
    expect(() => loadKeyRing(ec, undefined)).toThrow(/Ed25519/);
  });
});
