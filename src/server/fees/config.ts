// Finance settings for one school, with defaults for a school that has not opened Finance settings yet.
import type { FinanceSettings } from "@prisma/client";

export type FinanceConfig = Omit<FinanceSettings, "id" | "orgId" | "updatedAt"> & { saved: boolean };

export const FINANCE_DEFAULTS: Omit<FinanceConfig, "saved"> = {
  legalNameEn: null,
  legalNameAr: null,
  addressEn: null,
  addressAr: null,
  trn: null,
  vatRegistered: true,
  standardVatBp: 500,
  invoicePrefix: "INV",
  proformaPrefix: "PF",
  creditNotePrefix: "CN",
  receiptPrefix: "RCT",
  refundPrefix: "RF",
  paymentTermsDays: 14,
  siblingSecondBp: 500,
  siblingThirdBp: 1000,
  siblingFourthBp: 1000,
  discountStacking: "STACK",
  earlyPaymentBp: 0,
  earlyPaymentDays: 0,
  proRataBasis: "MONTH",
  proRataCutoffDay: 15,
  remindersEnabled: true,
  reminderDaysBefore: 7,
  reminderDaysAfter: [7, 21, 45],
  holdReportCards: false,
  holdAfterDays: 30,
  onlinePayments: false,
  bankDetailsEn: null,
  bankDetailsAr: null,
};

type Reader = { financeSettings: { findUnique(args: { where: { orgId: string } }): Promise<FinanceSettings | null> } };

export async function loadFinanceConfig(db: Reader, orgId: string): Promise<FinanceConfig> {
  const row = await db.financeSettings.findUnique({ where: { orgId } });
  if (!row) return { ...FINANCE_DEFAULTS, saved: false };
  const { id: _id, orgId: _org, updatedAt: _u, ...rest } = row;
  return { ...rest, saved: true };
}

/** UAE TRNs are 15 digits. */
export function validTrn(trn: string | null | undefined): boolean {
  return Boolean(trn && /^\d{15}$/.test(trn));
}

export type Seller = { nameEn: string; nameAr: string; addressEn: string; addressAr: string; trn: string | null; vatRegistered: boolean };

/** The school's legal identity as printed on a tax invoice (frozen on the invoice when it is issued). */
export function sellerFor(org: { nameEn: string; nameAr: string; emirate: string }, cfg: FinanceConfig): Seller {
  return {
    nameEn: cfg.legalNameEn?.trim() || org.nameEn,
    nameAr: cfg.legalNameAr?.trim() || org.nameAr,
    addressEn: cfg.addressEn?.trim() || `${org.emirate}, United Arab Emirates`,
    addressAr: cfg.addressAr?.trim() || "الإمارات العربية المتحدة",
    trn: cfg.trn,
    vatRegistered: cfg.vatRegistered,
  };
}

/** What still blocks tax invoices: the legal name, address and TRN (when VAT registered). */
export function taxInvoiceBlockers(cfg: FinanceConfig): Array<"LEGAL_NAME" | "ADDRESS" | "TRN"> {
  const out: Array<"LEGAL_NAME" | "ADDRESS" | "TRN"> = [];
  if (!cfg.legalNameEn?.trim() || !cfg.legalNameAr?.trim()) out.push("LEGAL_NAME");
  if (!cfg.addressEn?.trim()) out.push("ADDRESS");
  if (cfg.vatRegistered && !validTrn(cfg.trn)) out.push("TRN");
  return out;
}
