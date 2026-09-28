// Worker handlers against real Postgres through the RLS-restricted app role: delivery is idempotent.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { deliverOutbound, sweepOrg, testIdempotent, type OutgoingMessage, type Sender } from "@/worker/handlers";
import { ownerClient, uid } from "./helpers";

let owner: PrismaClient;
let orgId: string;

beforeAll(async () => {
  owner = ownerClient();
  const slug = uid("worker-itest");
  const org = await owner.organization.create({ data: { slug, nameEn: "Worker Test School", nameAr: "مدرسة اختبار العامل" } });
  orgId = org.id;
});

afterAll(async () => {
  if (orgId) {
    await owner.outboundMessage.deleteMany({ where: { orgId } });
    await owner.jobRun.deleteMany({ where: { orgId } });
    await owner.organization.delete({ where: { id: orgId } }).catch(() => undefined);
  }
  await owner?.$disconnect();
});

function recordingSender() {
  const sent: OutgoingMessage[] = [];
  const send: Sender = async (msg) => {
    sent.push(msg);
    return { providerId: `test-${sent.length}` };
  };
  return { sent, send };
}

async function queuedMessage(createdAt = new Date()) {
  return owner.outboundMessage.create({
    data: { orgId, channel: "EMAIL", to: "someone@worker.example", subject: "Test", idempotencyKey: uid("key"), status: "QUEUED", createdAt },
  });
}

describe("outbound delivery", () => {
  it("sends a message once even when the job runs twice", async () => {
    const row = await queuedMessage();
    const { sent, send } = recordingSender();
    const first = await deliverOutbound({ orgId, outboundId: row.id, locale: "en", body: "Hello", href: "/requests" }, { send });
    const second = await deliverOutbound({ orgId, outboundId: row.id, locale: "en", body: "Hello", href: "/requests" }, { send });
    expect(first).toBe("sent");
    expect(second).toBe("skipped");
    expect(sent).toHaveLength(1);
    const after = await owner.outboundMessage.findUniqueOrThrow({ where: { id: row.id } });
    expect(after.status).toBe("SENT");
    expect(after.providerId).toBe("test-1");
    expect(after.sentAt).not.toBeNull();
  });

  it("sends once when two deliveries race", async () => {
    const row = await queuedMessage();
    const { sent, send } = recordingSender();
    const results = await Promise.all([deliverOutbound({ orgId, outboundId: row.id }, { send }), deliverOutbound({ orgId, outboundId: row.id }, { send })]);
    expect(results.filter((r) => r === "sent")).toHaveLength(1);
    expect(sent).toHaveLength(1);
  });

  it("marks a message FAILED when the provider throws and does not resend it", async () => {
    const row = await queuedMessage();
    let calls = 0;
    const failing: Sender = async () => {
      calls++;
      throw new Error("provider_down");
    };
    expect(await deliverOutbound({ orgId, outboundId: row.id }, { send: failing })).toBe("failed");
    expect(await deliverOutbound({ orgId, outboundId: row.id }, { send: failing })).toBe("skipped");
    expect(calls).toBe(1);
    const after = await owner.outboundMessage.findUniqueOrThrow({ where: { id: row.id } });
    expect(after.status).toBe("FAILED");
    expect(after.error).toBe("provider_down");
  });

  it("the sweeper picks up stale queued messages only", async () => {
    const now = new Date();
    const stale = await queuedMessage(new Date(now.getTime() - 5 * 60_000));
    const fresh = await queuedMessage(now);
    const { sent, send } = recordingSender();
    const counts = await sweepOrg(orgId, { now, send, flush: async () => undefined });
    expect(counts.outbound).toBe(1);
    expect(sent.map((m) => m.id)).toEqual([stale.id]);
    const again = await sweepOrg(orgId, { now, send, flush: async () => undefined });
    expect(again.outbound).toBe(0);
    expect((await owner.outboundMessage.findUniqueOrThrow({ where: { id: fresh.id } })).status).toBe("QUEUED");
  });
});

describe("test.idempotent job", () => {
  it("records a key once", async () => {
    const key = uid("probe");
    expect(await testIdempotent({ orgId, key })).toBe("done");
    expect(await testIdempotent({ orgId, key })).toBe("duplicate");
    expect(await owner.jobRun.count({ where: { orgId, idempotencyKey: `test:${key}` } })).toBe(1);
  });
});
