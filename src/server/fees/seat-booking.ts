// Admissions integration: a seat booking charge for an applicant family.
//
// Two entry points:
// - feesSeatBookingProvider: the provider admissions calls (registerSeatBookingProvider, wired in admissions-link.ts)
//   inside its own transaction when a family accepts an offer. It creates one proforma invoice per application on an
//   applicant family account and returns the proforma number as the reference. When that proforma is paid in full
//   (recorded by finance, or online), it becomes a tax invoice and the seat paid hook (hooks.ts) tells admissions.
// - createSeatBookingCharge(orgId, applicationRef, amountFils, payer): the same charge for callers outside a
//   transaction; it also returns a payment link when online payment is set up for logged-in families.
// The caller is responsible for the permission check (admissions staff, or the family accepting its own offer).
import { tenantTx } from "@/lib/tenant-db";
import type { ExecCtx, Tx } from "@/server/db";
import { createPaymentLink } from "@/server/payments/links";
import { loadFinanceConfig } from "./config";
import { SEAT_REF_PREFIX } from "./hooks";
import { FeeError, issueInvoice, type Actor } from "./ledger";
import { nextDocNumber } from "./numbering";

export type SeatBookingPayer = {
  name: string;
  nameAr?: string | null;
  email?: string | null;
  /** The guardian record when the family already exists in the school. */
  guardianId?: string | null;
  /** A company paying for the seat (name is then the company's legal name). */
  sponsor?: { trn?: string | null; address?: string | null } | null;
};

export type SeatBookingResult =
  | { ok: true; invoiceId: string; number: string; amountFils: number; status: string; paymentUrl: string | null; reused: boolean }
  | { ok: false; error: "INVALID_INPUT" | "TAX_SETUP_INCOMPLETE" | "FAILED" };

const appBase = () => (process.env.APP_URL || process.env.AUTH_URL || process.env.NEXTAUTH_URL || "").replace(/\/+$/, "");

/** One proforma per application reference (sourceRef "seat:<ref>"), in the caller's transaction. */
export async function issueSeatProforma(
  tx: Tx,
  orgId: string,
  input: { ref: string; amountFils: number; payer: SeatBookingPayer; description?: { en: string; ar: string } | null },
  now: Date,
  actor: Actor,
) {
  const sourceRef = `${SEAT_REF_PREFIX}${input.ref}`;
  const existing = await tx.invoice.findFirst({ where: { orgId, sourceRef, kind: "PROFORMA", status: { in: ["OPEN", "CONVERTED"] } }, orderBy: { createdAt: "desc" } });
  if (existing) return { id: existing.id, number: existing.number, totalFils: existing.totalFils, status: existing.status, reused: true };
  const cfg = await loadFinanceConfig(tx, orgId);
  let account = await tx.feeAccount.findFirst({ where: { orgId, applicationRef: input.ref } });
  if (!account) {
    const payer = input.payer;
    const guardian = payer.guardianId ? await tx.guardian.findFirst({ where: { id: payer.guardianId, orgId } }) : null;
    account = await tx.feeAccount.create({
      data: {
        orgId,
        code: await nextDocNumber(tx, orgId, "FAM", "FAM", now),
        nameEn: payer.name.trim().slice(0, 120),
        nameAr: (payer.nameAr?.trim() || payer.name.trim()).slice(0, 120),
        payerType: payer.sponsor ? "SPONSOR" : "GUARDIAN",
        payerGuardianId: guardian?.id ?? null,
        sponsorName: payer.sponsor ? payer.name.trim().slice(0, 120) : null,
        sponsorTrn: payer.sponsor?.trn?.trim() || null,
        billingAddress: payer.sponsor?.address?.trim() || null,
        billingEmail: payer.email?.trim() || null,
        applicationRef: input.ref,
      },
    });
  }
  const item = await tx.feeItem.findFirst({ where: { orgId, kind: "SEAT_DEPOSIT", active: true }, orderBy: { createdAt: "desc" } });
  const inv = await issueInvoice(
    tx,
    orgId,
    {
      kind: "PROFORMA",
      accountId: account.id,
      academicYearId: item?.academicYearId ?? null,
      issueDate: now,
      dueDate: new Date(now.getTime() + cfg.paymentTermsDays * 86_400_000),
      lines: [
        {
          studentId: null,
          feeItemId: item?.id ?? null,
          kind: "SEAT_DEPOSIT",
          descriptionEn: (input.description?.en || `${item?.nameEn ?? "Seat booking deposit"}: application ${input.ref}`).slice(0, 300),
          descriptionAr: (input.description?.ar || `${item?.nameAr ?? "عربون حجز المقعد"}: طلب الالتحاق ${input.ref}`).slice(0, 300),
          quantity: 1,
          unitFils: input.amountFils,
          vatTreatment: item?.vatTreatment ?? "ZERO_RATED",
        },
      ],
      sourceRef,
    },
    actor,
    cfg,
  );
  return { id: inv.id, number: inv.number, totalFils: inv.totalFils, status: inv.status, reused: false };
}

export async function createSeatBookingCharge(
  orgId: string,
  applicationRef: string,
  amountFils: number,
  payer: SeatBookingPayer,
  opts: { now?: Date; locale?: "en" | "ar"; baseUrl?: string; actorId?: string | null } = {},
): Promise<SeatBookingResult> {
  const ref = applicationRef.trim();
  if (!ref || ref.length > 64 || !Number.isSafeInteger(amountFils) || amountFils <= 0 || !payer.name?.trim()) return { ok: false, error: "INVALID_INPUT" };
  const now = opts.now ?? new Date();
  const actor = { membershipId: opts.actorId ?? null, userId: null };
  let made: { id: string; number: string; totalFils: number; status: string; reused: boolean };
  try {
    made = await tenantTx(orgId, (tx) => issueSeatProforma(tx, orgId, { ref, amountFils, payer }, now, actor));
  } catch (e) {
    if (e instanceof FeeError && e.code === "TAX_SETUP_INCOMPLETE") return { ok: false, error: "TAX_SETUP_INCOMPLETE" };
    if (e instanceof FeeError) return { ok: false, error: "INVALID_INPUT" };
    return { ok: false, error: "FAILED" };
  }
  let paymentUrl: string | null = null;
  if (made.status === "OPEN") {
    const link = await createPaymentLink(orgId, { invoiceId: made.id, locale: opts.locale ?? "en", baseUrl: opts.baseUrl ?? appBase(), createdById: actor.membershipId }, now);
    if (link.ok) paymentUrl = link.url;
  }
  return { ok: true, invoiceId: made.id, number: made.number, amountFils: made.totalFils, status: made.status, paymentUrl, reused: made.reused };
}

// ---------------------------------------------------------------------------------------------
// The provider admissions calls (same shape as SeatBookingProvider in src/server/admissions/seat-booking.ts)
// ---------------------------------------------------------------------------------------------

export type SeatChargeRequestIn = {
  orgId: string;
  applicationId: string;
  applicationNumber: string;
  amountFils: number;
  currency: "AED";
  payerEmail: string | null;
  description: { en: string; ar: string };
  idempotencyKey: string;
};

type ApplicantGuardian = { firstNameEn?: string; lastNameEn?: string; firstNameAr?: string | null; lastNameAr?: string | null; email?: string; primary?: boolean };

/** The primary guardian's name as the family entered it on the application (read only when admissions is installed). */
async function applicantPayer(tx: Tx, orgId: string, req: SeatChargeRequestIn): Promise<SeatBookingPayer> {
  const fallback: SeatBookingPayer = { name: `Applicant ${req.applicationNumber}`, nameAr: `مقدم الطلب ${req.applicationNumber}`, email: req.payerEmail };
  const exists = await tx.$queryRaw<Array<{ t: string | null }>>`SELECT to_regclass('"AdmissionApplication"')::text AS t`;
  if (!exists[0]?.t) return fallback;
  const rows = await tx.$queryRaw<Array<{ guardians: unknown }>>`SELECT "guardians" FROM "AdmissionApplication" WHERE "id" = ${req.applicationId} AND "orgId" = ${orgId} LIMIT 1`;
  const list = Array.isArray(rows[0]?.guardians) ? (rows[0]!.guardians as ApplicantGuardian[]) : [];
  const g = list.find((x) => x.primary) ?? list[0];
  const en = [g?.firstNameEn, g?.lastNameEn].filter(Boolean).join(" ").trim();
  if (!en) return fallback;
  const ar = [g?.firstNameAr, g?.lastNameAr].filter(Boolean).join(" ").trim();
  return { name: en, nameAr: ar || en, email: req.payerEmail ?? g?.email ?? null };
}

export const feesSeatBookingProvider = {
  /** One proforma per application, in the admissions transaction. The family pays it like any invoice. */
  async createCharge(ec: ExecCtx, req: SeatChargeRequestIn): Promise<{ reference: string; payUrl: string | null }> {
    if (req.orgId !== ec.orgId || req.currency !== "AED" || !Number.isSafeInteger(req.amountFils) || req.amountFils <= 0) throw new FeeError("INVALID_INPUT");
    const payer = await applicantPayer(ec.tx, ec.orgId, req);
    const made = await issueSeatProforma(ec.tx, ec.orgId, { ref: req.applicationId, amountFils: req.amountFils, payer, description: req.description }, ec.now, { membershipId: ec.actorId ?? null, userId: null });
    // Applicants have no family login yet, so there is no online checkout link for them here: the family pays by
    // the school's usual means quoting the proforma number, and finance records it.
    return { reference: made.number, payUrl: null };
  },
};
