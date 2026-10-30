import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import { disconnectAll, ownerPrisma, withTenant } from "@aegis/db";
import { addUserWithRole, makeTestTenant, type TestTenant } from "./helpers.js";
import { notifyUsers } from "../src/notify/notifications.js";
import { deliverNotificationEmails, EMAIL_MAX_ATTEMPTS, resendEmailProvider, type EmailProvider } from "../src/notify/email.js";

/** A stand-in for Resend's POST /emails, with a scripted answer per request. */
interface Received {
  auth: string | undefined;
  idempotencyKey: string | undefined;
  body: { from: string; to: string[]; subject: string; text: string };
}
let server: Server;
let base = "";
const received: Received[] = [];
let answer: (n: number) => { status: number; body: unknown } = () => ({ status: 200, body: { id: "em_1" } });

let t: TestTenant;
let approver: { userId: string };
const run = <T,>(fn: Parameters<typeof withTenant<T>>[1]) => withTenant(t.orgId, fn);

beforeAll(async () => {
  server = createServer((req, res) => {
    let raw = "";
    req.on("data", (c: Buffer) => (raw += c.toString("utf8")));
    req.on("end", () => {
      received.push({ auth: req.headers.authorization, idempotencyKey: req.headers["idempotency-key"] as string | undefined, body: JSON.parse(raw) as Received["body"] });
      const a = answer(received.length);
      res.writeHead(a.status, { "content-type": "application/json" }).end(JSON.stringify(a.body));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  t = await makeTestTenant("mail");
  approver = await addUserWithRole(t, "approver", "appr");
});

afterAll(async () => {
  server.close();
  await t.cleanup();
  await ownerPrisma().user.delete({ where: { id: approver.userId } }).catch(() => undefined);
  await disconnectAll();
});

const provider = (): EmailProvider => resendEmailProvider("re_test_key_123", { baseUrl: base, from: "AEGIS <alerts@example.com>" });

describe("email copies of notifications", () => {
  it("does nothing when email notifications are off", async () => {
    await run((db) => notifyUsers(db, t.ownerCtx, { userIds: [approver.userId], type: "approval.requested", title: "Approval needed: off", link: "/approvals/x0", idempotencyKey: "mail:off" }));
    const out = await deliverNotificationEmails(run, t.orgId, { provider: null });
    expect(out).toEqual({ sent: 0, failed: 0, retrying: 0 });
    expect(received).toHaveLength(0);
    await run((db) => db.notification.deleteMany({ where: { orgId: t.orgId } }));
  });

  it("mails action notifications once, through Resend with an idempotency key, and skips the rest", async () => {
    received.length = 0;
    answer = () => ({ status: 200, body: { id: "em_ok" } });
    await run(async (db) => {
      await notifyUsers(db, t.ownerCtx, { userIds: [approver.userId], type: "approval.requested", title: "Approval needed: refund-agent wants to issue-refund", body: "Amount above the autonomous limit", link: "/approvals/a1", idempotencyKey: "mail:a1" });
      await notifyUsers(db, t.ownerCtx, { userIds: [approver.userId], type: "approval.approved", title: "Approved: not mailed", idempotencyKey: "mail:a2" });
    });
    const first = await deliverNotificationEmails(run, t.orgId, { provider: provider() });
    expect(first).toEqual({ sent: 1, failed: 0, retrying: 0 });
    expect(received).toHaveLength(1);
    const r = received[0]!;
    expect(r.auth).toBe("Bearer re_test_key_123");
    expect(r.idempotencyKey).toMatch(/^aegis-notification-[0-9a-f-]{36}$/);
    const email = await run((db) => db.user.findUniqueOrThrow({ where: { id: approver.userId }, select: { email: true } }));
    expect(r.body.to).toEqual([email.email]);
    expect(r.body.from).toBe("AEGIS <alerts@example.com>");
    expect(r.body.subject).toBe("[AEGIS] Approval needed: refund-agent wants to issue-refund");
    expect(r.body.text).toContain("Amount above the autonomous limit");
    expect(r.body.text).toMatch(/Open in AEGIS: https?:\/\/[^\s]+\/approvals\/a1/);
    expect(r.body.text).toContain("nothing in this email approves");

    const again = await deliverNotificationEmails(run, t.orgId, { provider: provider() });
    expect(again.sent).toBe(0);
    expect(received).toHaveLength(1);
    const rows = await run((db) => db.notification.findMany({ where: { orgId: t.orgId }, select: { type: true, emailedAt: true } }));
    expect(rows.find((x) => x.type === "approval.requested")?.emailedAt).toBeInstanceOf(Date);
    expect(rows.find((x) => x.type === "approval.approved")?.emailedAt).toBeNull();
  });

  it("retries a temporary failure with the same idempotency key, and stops at once on a refusal", async () => {
    received.length = 0;
    await run((db) => db.notification.deleteMany({ where: { orgId: t.orgId } }));
    await run((db) => notifyUsers(db, t.ownerCtx, { userIds: [approver.userId], type: "alert.raised", title: "Repeated denials", link: "/alerts?focus=1", idempotencyKey: "mail:alert" }));
    answer = () => ({ status: 503, body: { message: "busy" } });
    expect(await deliverNotificationEmails(run, t.orgId, { provider: provider() })).toEqual({ sent: 0, failed: 0, retrying: 1 });
    answer = () => ({ status: 200, body: { id: "em_after_retry" } });
    expect(await deliverNotificationEmails(run, t.orgId, { provider: provider() })).toEqual({ sent: 1, failed: 0, retrying: 0 });
    expect(received).toHaveLength(2);
    expect(received[0]!.idempotencyKey).toBe(received[1]!.idempotencyKey);
    const n = await run((db) => db.notification.findFirstOrThrow({ where: { orgId: t.orgId, type: "alert.raised" } }));
    expect(n.emailAttempts).toBe(2);
    expect(n.emailError).toBeNull();

    received.length = 0;
    await run((db) => notifyUsers(db, t.ownerCtx, { userIds: [approver.userId], type: "incident.created", title: "Incident #1", idempotencyKey: "mail:inc" }));
    answer = () => ({ status: 422, body: { message: "The from address is not verified" } });
    expect(await deliverNotificationEmails(run, t.orgId, { provider: provider() })).toEqual({ sent: 0, failed: 1, retrying: 0 });
    expect(await deliverNotificationEmails(run, t.orgId, { provider: provider() })).toEqual({ sent: 0, failed: 0, retrying: 0 });
    expect(received).toHaveLength(1);
    const inc = await run((db) => db.notification.findFirstOrThrow({ where: { orgId: t.orgId, type: "incident.created" } }));
    expect(inc.emailAttempts).toBe(EMAIL_MAX_ATTEMPTS);
    expect(inc.emailError).toBe("HTTP 422: The from address is not verified");
  });

  it("never mails a disabled user, and never mails another organization's notifications", async () => {
    received.length = 0;
    answer = () => ({ status: 200, body: { id: "em_x" } });
    await run((db) => db.notification.deleteMany({ where: { orgId: t.orgId } }));
    const other = await makeTestTenant("mail-other");
    try {
      await withTenant(other.orgId, (db) => notifyUsers(db, other.ownerCtx, { userIds: [other.ownerUserId], type: "approval.requested", title: "Other org", idempotencyKey: "mail:other" }));
      await ownerPrisma().user.update({ where: { id: approver.userId }, data: { status: "disabled" } });
      await run((db) => notifyUsers(db, t.ownerCtx, { userIds: [approver.userId], type: "approval.requested", title: "To a disabled user", idempotencyKey: "mail:susp" }));
      const out = await deliverNotificationEmails(run, t.orgId, { provider: provider() });
      expect(out).toEqual({ sent: 0, failed: 1, retrying: 0 });
      expect(received).toHaveLength(0);
      const otherRow = await withTenant(other.orgId, (db) => db.notification.findFirstOrThrow({ where: { orgId: other.orgId } }));
      expect(otherRow.emailedAt).toBeNull();
      expect(otherRow.emailAttempts).toBe(0);
    } finally {
      await ownerPrisma().user.update({ where: { id: approver.userId }, data: { status: "active" } });
      await other.cleanup();
    }
  });
});
