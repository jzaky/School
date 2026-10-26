// Admissions integration: a seat booking charge for an applicant family.
// createSeatBookingCharge creates (once per application) a proforma invoice for the seat deposit on an applicant
// family account and returns a payment link when online payment is set up. When the family pays online the
// proforma becomes a tax invoice automatically (src/server/payments/links.ts); finance can also record a manual
// payment against it. The caller is responsible for the permission check (admissions staff).
import { tenantTx } from "@/lib/tenant-db";
import { createPaymentLink } from "@/server/payments/links";
import { loadFinanceConfig } from "./config";
import { FeeError, issueInvoice } from "./ledger";
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
  const sourceRef = `seat:${ref}`;
  const actor = { membershipId: opts.actorId ?? null, userId: null };
  let made: { id: string; number: string; totalFils: number; status: string; reused: boolean };
  try {
    made = await tenantTx(orgId, async (tx) => {
      const existing = await tx.invoice.findFirst({ where: { orgId, sourceRef, kind: "PROFORMA", status: { in: ["OPEN", "CONVERTED"] } }, orderBy: { createdAt: "desc" } });
      if (existing) return { id: existing.id, number: existing.number, totalFils: existing.totalFils, status: existing.status, reused: true };
      const cfg = await loadFinanceConfig(tx, orgId);
      let account = await tx.feeAccount.findFirst({ where: { orgId, applicationRef: ref } });
      if (!account) {
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
            applicationRef: ref,
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
              descriptionEn: `${item?.nameEn ?? "Seat booking deposit"}: application ${ref}`,
              descriptionAr: `${item?.nameAr ?? "عربون حجز المقعد"}: طلب الالتحاق ${ref}`,
              quantity: 1,
              unitFils: amountFils,
              vatTreatment: item?.vatTreatment ?? "ZERO_RATED",
            },
          ],
          sourceRef,
        },
        actor,
        cfg,
      );
      return { id: inv.id, number: inv.number, totalFils: inv.totalFils, status: inv.status, reused: false };
    });
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
