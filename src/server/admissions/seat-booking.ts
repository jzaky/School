// Seat booking: the amount a family pays to hold an accepted place, set per grade (AdmissionCapacity.seatFeeFils,
// integer fils, AED x 100). Horizon does not process payments itself.
//
// How fees plug in: the fees module registers a provider with registerSeatBookingProvider(). When the family accepts
// an offer, createSeatBookingCharge() asks the provider for a charge (an invoice line) and stores its reference and,
// if there is one, a payment link the family sees on the application page. When the payment clears, the fees module
// calls markSeatPaid() with its own reference, which moves the application to "Seat booking paid" exactly once.
// Until a provider is registered (and FEES_SEAT_BOOKING is "on"), staff record payments by hand with "Mark paid",
// and the family sees the amount plus the school's own payment portal link (Organization.feePaymentUrl) when set.
import type { ExecCtx } from "@/server/db";
import { audit } from "@/server/audit/audit";
import { AdmissionError } from "./access";
import { mailFamily } from "./email";
import { recordEvent } from "./events";
import { childNameBoth } from "./labels";

export type SeatChargeRequest = {
  orgId: string;
  applicationId: string;
  applicationNumber: string;
  amountFils: number;
  currency: "AED";
  payerEmail: string | null;
  description: { en: string; ar: string };
  /** Stable key: one charge per application, however often this is called. */
  idempotencyKey: string;
};

export type SeatChargeResult = { reference: string; payUrl: string | null };

export interface SeatBookingProvider {
  createCharge(ec: ExecCtx, req: SeatChargeRequest): Promise<SeatChargeResult>;
}

const g = globalThis as unknown as { __seatProvider?: SeatBookingProvider | null };

/** Called by the fees module at start-up. */
export function registerSeatBookingProvider(p: SeatBookingProvider | null) {
  g.__seatProvider = p;
}

/** The feature check: a provider is registered and the school's deployment switched it on. */
export function seatBookingProvider(): SeatBookingProvider | null {
  if (process.env.FEES_SEAT_BOOKING !== "on") return null;
  return g.__seatProvider ?? null;
}

/**
 * Ask the fees module for a seat booking charge, once per application. Returns "manual" when no provider is set up
 * (staff mark payments by hand) or "none" when the grade has no seat booking amount.
 */
export async function createSeatBookingCharge(ec: ExecCtx, applicationId: string): Promise<"created" | "exists" | "manual" | "none"> {
  const { tx, orgId } = ec;
  const app = await tx.admissionApplication.findFirst({ where: { id: applicationId, orgId } });
  if (!app) throw new AdmissionError("NOT_FOUND");
  const cap = await tx.admissionCapacity.findUnique({ where: { orgId_academicYearId_gradeLevel: { orgId, academicYearId: app.academicYearId, gradeLevel: app.gradeLevel } } });
  const amount = app.seatFeeFils ?? cap?.seatFeeFils ?? 0;
  if (app.seatFeeFils === null) await tx.admissionApplication.update({ where: { id: app.id }, data: { seatFeeFils: amount } });
  if (amount <= 0) return "none";
  if (app.seatChargeRef) return "exists";
  const provider = seatBookingProvider();
  if (!provider) return "manual";
  const payer = await tx.admissionApplication.findUnique({ where: { id: app.id }, select: { guardians: true } });
  const primary = ((payer?.guardians as Array<{ email: string; primary?: boolean }> | null) ?? []).find((x) => x.primary);
  const child = childNameBoth(app);
  const res = await provider.createCharge(ec, {
    orgId,
    applicationId: app.id,
    applicationNumber: app.number,
    amountFils: amount,
    currency: "AED",
    payerEmail: primary?.email ?? null,
    description: { en: `Seat booking: ${child.en} (${app.number})`, ar: `حجز مقعد: ${child.ar} (${app.number})` },
    idempotencyKey: `seat:${app.id}`,
  });
  await tx.admissionApplication.update({ where: { id: app.id }, data: { seatChargeRef: res.reference.slice(0, 120), seatPayUrl: res.payUrl && /^https:\/\//.test(res.payUrl) ? res.payUrl.slice(0, 500) : null } });
  await recordEvent(tx, orgId, { applicationId: app.id, kind: "payment", data: { charge: "created", amountFils: amount }, at: ec.now });
  return "created";
}

/**
 * Record the seat booking payment: by staff ("Mark paid") or by the fees module when a charge is paid.
 * Idempotent: a second call for a paid application changes nothing.
 */
export async function markSeatPaid(
  ec: ExecCtx,
  input: { applicationId: string; reference: string | null; actor: { membershipId: string | null; userId: string | null } | null; source: "staff" | "fees"; family?: { email: string; locale: "en" | "ar"; slug: string; school: { en: string; ar: string } } | null },
): Promise<"paid" | "already"> {
  const { tx, orgId, now } = ec;
  const app = await tx.admissionApplication.findFirst({ where: { id: input.applicationId, orgId } });
  if (!app) throw new AdmissionError("NOT_FOUND");
  if (app.seatPaidAt) return "already";
  if (app.stage !== "OFFER_ACCEPTED") throw new AdmissionError("INVALID_STAGE");
  const ref = (input.reference ?? "").trim().slice(0, 80) || null;
  await tx.admissionApplication.update({ where: { id: app.id }, data: { stage: "SEAT_PAID", stageChangedAt: now, seatPaidAt: now, seatPaymentRef: ref } });
  await recordEvent(tx, orgId, { applicationId: app.id, kind: "payment", fromStage: app.stage, toStage: "SEAT_PAID", actorMembershipId: input.actor?.membershipId ?? null, data: { source: input.source, amountFils: app.seatFeeFils ?? 0 }, at: now });
  await audit(tx, orgId, { actorId: input.actor?.membershipId ?? null, actorUserId: input.actor?.userId ?? null, action: "admission.seat_paid", entityType: "AdmissionApplication", entityId: app.id, meta: { source: input.source, amountFils: app.seatFeeFils ?? 0, hasReference: Boolean(ref) } });
  if (input.family) {
    await mailFamily(ec, { to: input.family.email, kind: "paid", locale: input.family.locale, vars: { school: input.family.school, child: childNameBoth(app) }, href: `/apply/${input.family.slug}/${app.id}`, idempotencyKey: `adm:${app.id}:paid` });
  }
  return "paid";
}
