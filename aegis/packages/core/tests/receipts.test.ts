import { afterAll, beforeAll, describe, expect, it } from "vitest";
import sharp from "sharp";
import { disconnectAll, ownerPrisma, withTenant } from "@aegis/db";
import { registerUser } from "../src/identity/auth.js";
import { listUserMemberships } from "../src/identity/memberships.js";
import { makeContext, type OrgContext } from "../src/lib/context.js";
import { authorizeAndExecute, recordAgentExecution } from "../src/gateway/gateway.js";
import { amountToMinor, extractReceiptText, minorToAmount, registerTransactions, setClaimRule, submitExpenseClaim, vatOn } from "../src/payments/receipts.js";
import { setupSectorLab } from "../src/validation/sector-lab.js";
import { COUNCIL_PACK } from "../src/validation/council.js";

/** A receipt picture rendered from text, so the image tests use real PNG files. */
const receiptPng = (lines: string[], width = 360) =>
  sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${40 + lines.length * 28}"><rect width="100%" height="100%" fill="white"/>${lines.map((l, i) => `<text x="16" y="${36 + i * 28}" font-family="monospace" font-size="18" fill="black">${l}</text>`).join("")}</svg>`)).png().toBuffer();

const day = (d: number) => new Date(Date.UTC(2026, 9, 20 + d, 10));

describe("expense receipt validation", () => {
  let orgId: string;
  let userId: string;
  let owner: OrgContext;
  let agentId: string;
  let n = 0;
  const claim = (input: Record<string, unknown>, ctx = owner) => withTenant(orgId, (db) => submitExpenseClaim(db, ctx, input));
  const base = { claimantRef: "EMP-1042", cardRef: "CARD-7781", jurisdiction: "AE", currency: "AED" };
  const reimburse = (claimId: string, amount: number | string) => authorizeAndExecute(withTenant, makeContext(orgId, { type: "agent", id: agentId, label: "finance-operations-agent" }), { tool: "pay-expense-claim", action: "execute", params: { claimId, amount, currency: "AED" }, context: {}, justification: "", idempotencyKey: `rc-${Date.now()}-${++n}`, principal: { type: "system" }, executionMode: "agent" });
  let genuine: Buffer;

  beforeAll(async () => {
    userId = (await registerUser({ email: `receipts-${Date.now().toString(36)}@test.aegis.local`, name: "Receipts", password: "CorrectHorse1Battery" })).id;
    orgId = (await setupSectorLab(userId, [COUNCIL_PACK])).id;
    const m = (await listUserMemberships(userId)).find((x) => x.orgId === orgId)!;
    owner = makeContext(orgId, { type: "user", id: userId, permissions: m.permissions, membershipId: m.membershipId, label: "Finance" });
    await withTenant(orgId, async (db) => {
      agentId = (await db.agent.findFirstOrThrow({ where: { orgId, slug: "finance-operations-agent" } })).id;
      const tool = await db.tool.findFirstOrThrow({ where: { orgId, key: "pay-expense-claim" } });
      await setClaimRule(db, owner, tool.id, { claimParam: "claimId", amountParam: "amount" });
      // The card feed: what really happened on the card.
      await registerTransactions(db, owner, {
        transactions: [
          { ref: "TX-1", merchantName: "COMFORT TRANSPORT LLC", cardRef: "CARD-7781", amount: "27.34", currency: "AED", postedAt: day(1) },
          { ref: "TX-2", merchantName: "Skyline Dining", cardRef: "CARD-7781", amount: "420.00", currency: "AED", postedAt: day(2) },
          { ref: "TX-3", merchantName: "Gulf Office Supplies", cardRef: "CARD-7781", amount: "315.00", currency: "AED", postedAt: day(3) },
          { ref: "TX-3R", kind: "refund", merchantName: "Gulf Office Supplies", cardRef: "CARD-7781", amount: "315.00", currency: "AED", postedAt: day(5), originalRef: "TX-3" },
          { ref: "TX-4A", merchantName: "Marina Hotel", cardRef: "CARD-7781", amount: "600.00", currency: "AED", postedAt: day(4) },
          { ref: "TX-4B", merchantName: "Marina Hotel", cardRef: "CARD-7781", amount: "450.00", currency: "AED", postedAt: day(4) },
          { ref: "TX-5", merchantName: "Desert Print", cardRef: "CARD-7781", amount: "105.00", currency: "AED", postedAt: day(6) },
        ],
      });
    });
    genuine = await receiptPng(["COMFORT TRANSPORT", "RECEIPT 5761", "FARE      AED 26.04", "VAT 5%    AED  1.30", "TOTAL     AED 27.34"]);
  }, 60_000);
  afterAll(async () => {
    await ownerPrisma().organization.delete({ where: { id: orgId } }).catch(() => undefined);
    await ownerPrisma().user.delete({ where: { id: userId } }).catch(() => undefined);
    await disconnectAll();
  });

  it("does money in exact minor units and VAT with half-up rounding", () => {
    expect(amountToMinor("27.34")).toBe(2734n);
    expect(amountToMinor(0.1 + 0.2)).toBe(30n);
    expect(amountToMinor("1,000.00".replace(/,/g, ""))).toBe(100000n);
    expect(() => amountToMinor("1.005")).toThrow();
    expect(minorToAmount(2734n)).toBe("27.34");
    expect(vatOn(2604n, 500)).toBe(130n);
    expect(vatOn(1010n, 500)).toBe(51n);
  });

  it("reads a typed receipt's fields", () => {
    const r = extractReceiptText("COMFORT TRANSPORT LLC\nTRN 100234567890003\nDate 21/10/2026\nSubtotal AED 26.04\nVAT 5% AED 1.30\nTotal AED 27.34");
    expect(r).toMatchObject({ merchantName: "COMFORT TRANSPORT LLC", date: "2026-10-21", subtotal: "26.04", vat: "1.30", total: "27.34", trn: "100234567890003", currency: "AED" });
  });

  it("a genuine claim matches the card charge, the totals and the 5% UAE VAT", async () => {
    const r = await claim({ ...base, ref: "CL-1", merchantName: "Comfort Transport", receiptDate: day(1), subtotal: "26.04", vat: "1.30", total: "27.34", trn: "100234567890003", receiptBase64: genuine.toString("base64") });
    expect(r.verdict).toBe("verified_match");
    expect(r.findings.map((f) => f.code)).toEqual(expect.arrayContaining(["totals_add_up", "vat_rate_correct", "trn_format_ok", "transaction_matches"]));
  });

  it("an inflated receipt (27.34 claimed as 2,734) is a confirmed mismatch against the card charge", async () => {
    const r = await claim({ ...base, ref: "CL-2", merchantName: "Comfort Transport", receiptDate: day(1), subtotal: "2603.81", vat: "130.19", total: "2734.00", trn: "100234567890003" });
    expect(r.verdict).toBe("confirmed_mismatch");
    expect(r.findings.find((f) => f.code === "amount_differs_from_charge")?.message).toMatch(/charged AED 27\.34 .* receipt says AED 2734\.00/);
  });

  it("the same receipt file claimed again is a duplicate, and the same charge cannot be claimed twice", async () => {
    const r = await claim({ ...base, ref: "CL-3", merchantName: "Comfort Transport", receiptDate: day(1), subtotal: "26.04", vat: "1.30", total: "27.34", trn: "100234567890003", receiptBase64: genuine.toString("base64") });
    expect(r.verdict).toBe("confirmed_mismatch");
    expect(r.findings.map((f) => f.code)).toEqual(expect.arrayContaining(["duplicate_receipt_file", "transaction_already_claimed"]));
  });

  it("a resized copy of an earlier receipt image is caught by its picture hash and sent to a person", async () => {
    const resized = await sharp(genuine).resize(300).jpeg({ quality: 70 }).toBuffer();
    const r = await claim({ ...base, ref: "CL-4", merchantName: "Desert Print", receiptDate: day(6), total: "105.00", receiptBase64: resized.toString("base64") });
    expect(r.verdict).toBe("requires_review");
    expect(r.findings.find((f) => f.code === "reused_receipt_image")?.message).toMatch(/closely matches the one in CL-[13]/);
  });

  it("an AI-generated label sends the claim to a person but is never treated as proof", async () => {
    const img = await receiptPng(["SKYLINE DINING", "TOTAL AED 420.00"]);
    const labelled = Buffer.concat([img, Buffer.from('<x:xmpmeta><Iptc4xmpExt:DigitalSourceType>http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia</Iptc4xmpExt:DigitalSourceType></x:xmpmeta>')]);
    const r = await claim({ ...base, ref: "CL-5", merchantName: "Skyline Dining", receiptDate: day(2), total: "420.00", receiptBase64: labelled.toString("base64") });
    expect(r.verdict).toBe("requires_review");
    const f = r.findings.find((x) => x.code === "ai_generated_label")!;
    expect(f.level).toBe("review");
    expect(f.message).toMatch(/indicator, not proof/);
  });

  it("refunds, split payments, wrong VAT, bad totals, future dates and missing records each get the right verdict", async () => {
    const refunded = await claim({ ...base, ref: "CL-6", merchantName: "Gulf Office Supplies LLC", receiptDate: day(3), total: "315.00" });
    expect(refunded.verdict).toBe("confirmed_mismatch");
    expect(refunded.findings.map((f) => f.code)).toContain("transaction_reversed");

    const split = await claim({ ...base, ref: "CL-7", merchantName: "Marina Hotel", receiptDate: day(4), subtotal: "1000.00", vat: "50.00", total: "1050.00", trn: "100234567890003" });
    expect(split.verdict).toBe("verified_match");
    expect(split.findings.find((f) => f.code === "split_transaction_matches")?.message).toMatch(/TX-4A, TX-4B/);

    const vat = await claim({ ...base, ref: "CL-8", cardRef: "CARD-9999", merchantName: "Corner Cafe", receiptDate: day(2), subtotal: "100.00", vat: "10.00", total: "110.00", trn: "100234567890003" });
    expect(vat.findings.map((f) => f.code)).toContain("vat_rate_wrong");

    const totals = await claim({ ...base, ref: "CL-9", cardRef: "CARD-9999", merchantName: "Corner Cafe", receiptDate: day(2), subtotal: "100.00", vat: "5.00", total: "115.00" });
    expect(totals.verdict).toBe("confirmed_mismatch");

    const future = await claim({ ...base, ref: "CL-10", cardRef: "CARD-9999", merchantName: "Corner Cafe", receiptDate: new Date(Date.now() + 10 * 86_400_000), total: "20.00" });
    expect(future.findings.map((f) => f.code)).toContain("receipt_dated_in_future");

    const none = await claim({ ...base, ref: "CL-11", cardRef: "CARD-0000", merchantName: "Old Souk Taxi", receiptDate: new Date(Date.UTC(2026, 0, 3)), total: "45.00" });
    expect(none.verdict).toBe("insufficient_evidence");
  });

  it("agents cannot register transactions or claims", async () => {
    const agent = makeContext(orgId, { type: "agent", id: agentId, label: "finance-operations-agent" });
    await expect(withTenant(orgId, (db) => registerTransactions(db, agent, { transactions: [{ ref: "TX-FAKE", merchantName: "x", amount: "1.00", currency: "AED", postedAt: day(1) }] }))).rejects.toThrow(/Agents cannot/);
    await expect(claim({ ...base, ref: "CL-FAKE", merchantName: "x", receiptDate: day(1), total: "1.00" }, agent)).rejects.toThrow(/Agents cannot/);
  });

  it("through the gateway: a verified claim is paid once, review goes to a person, mismatches and wrong amounts are refused", async () => {
    const paid = await reimburse("CL-1", "27.34");
    expect(paid.status).toBe("allowed");
    await withTenant(orgId, (db) => recordAgentExecution(db, makeContext(orgId, { type: "agent", id: agentId }), paid.requestId, { grant: paid.grant!.token, outcome: "succeeded" }));
    const twice = await reimburse("CL-1", "27.34");
    expect(twice.status).toBe("denied");
    expect(twice.reasons.join(" ")).toMatch(/already paid/);
    expect((await reimburse("CL-7", "1000.00")).reasons.join(" ")).toMatch(/is for AED 1050\.00/);
    const review = await reimburse("CL-5", "420.00");
    expect(review.status).toBe("pending_approval");
    expect(review.reasons.join(" ")).toMatch(/indicator, not proof/);
    const mismatch = await reimburse("CL-2", "2734.00");
    expect(mismatch.status).toBe("denied");
    expect(mismatch.reasons.join(" ")).toMatch(/does not match the records/);
    expect((await reimburse("CL-11", "45.00")).status).toBe("pending_approval");
    expect((await reimburse("CL-NOPE", "1.00")).status).toBe("denied");
  });
});
