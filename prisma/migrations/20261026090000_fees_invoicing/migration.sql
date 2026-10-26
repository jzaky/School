-- Fees and invoicing: fee schedule per academic year, family accounts, proforma and tax invoices with gapless
-- numbers, credit notes, payments with allocations, refunds, online payment links, webhook idempotency and
-- background billing runs. Money is stored as integers of fils.

-- CreateEnum
CREATE TYPE "FeeItemKind" AS ENUM ('TUITION', 'REGISTRATION', 'REENROLLMENT', 'SEAT_DEPOSIT', 'TRANSPORT', 'UNIFORM', 'BOOKS', 'TRIP', 'EXAM', 'OTHER');

-- CreateEnum
CREATE TYPE "VatTreatment" AS ENUM ('ZERO_RATED', 'STANDARD', 'EXEMPT', 'OUT_OF_SCOPE');

-- CreateEnum
CREATE TYPE "InstalmentPlanKind" AS ENUM ('ANNUAL', 'TERMLY', 'MONTHLY', 'CUSTOM');

-- CreateEnum
CREATE TYPE "FeeDiscountKind" AS ENUM ('SIBLING', 'STAFF_CHILD', 'SCHOLARSHIP', 'BURSARY', 'EARLY_PAYMENT', 'OTHER');

-- CreateEnum
CREATE TYPE "DiscountMethod" AS ENUM ('PERCENT', 'FIXED');

-- CreateEnum
CREATE TYPE "DiscountStacking" AS ENUM ('STACK', 'BEST_ONLY');

-- CreateEnum
CREATE TYPE "FeeAwardStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'REVOKED');

-- CreateEnum
CREATE TYPE "FeePayerType" AS ENUM ('GUARDIAN', 'SPONSOR');

-- CreateEnum
CREATE TYPE "InvoiceKind" AS ENUM ('PROFORMA', 'TAX');

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('OPEN', 'PARTIAL', 'PAID', 'CREDITED', 'CANCELLED', 'CONVERTED');

-- CreateEnum
CREATE TYPE "FeePaymentMethod" AS ENUM ('CASH', 'CHEQUE', 'BANK_TRANSFER', 'CARD', 'ONLINE');

-- CreateEnum
CREATE TYPE "FeePaymentStatus" AS ENUM ('HELD', 'CLEARED', 'BOUNCED');

-- CreateEnum
CREATE TYPE "RefundStatus" AS ENUM ('REQUESTED', 'APPROVED', 'REJECTED', 'PAID');

-- CreateEnum
CREATE TYPE "PaymentLinkStatus" AS ENUM ('OPEN', 'PAID', 'EXPIRED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "BillingRunStatus" AS ENUM ('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ProRataBasis" AS ENUM ('MONTH', 'DAY', 'TERM', 'NONE');

-- CreateTable
CREATE TABLE "FinanceSettings" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "legalNameEn" TEXT,
    "legalNameAr" TEXT,
    "addressEn" TEXT,
    "addressAr" TEXT,
    "trn" TEXT,
    "vatRegistered" BOOLEAN NOT NULL DEFAULT true,
    "standardVatBp" INTEGER NOT NULL DEFAULT 500,
    "invoicePrefix" TEXT NOT NULL DEFAULT 'INV',
    "proformaPrefix" TEXT NOT NULL DEFAULT 'PF',
    "creditNotePrefix" TEXT NOT NULL DEFAULT 'CN',
    "receiptPrefix" TEXT NOT NULL DEFAULT 'RCT',
    "refundPrefix" TEXT NOT NULL DEFAULT 'RF',
    "paymentTermsDays" INTEGER NOT NULL DEFAULT 14,
    "siblingSecondBp" INTEGER NOT NULL DEFAULT 500,
    "siblingThirdBp" INTEGER NOT NULL DEFAULT 1000,
    "siblingFourthBp" INTEGER NOT NULL DEFAULT 1000,
    "discountStacking" "DiscountStacking" NOT NULL DEFAULT 'STACK',
    "earlyPaymentBp" INTEGER NOT NULL DEFAULT 0,
    "earlyPaymentDays" INTEGER NOT NULL DEFAULT 0,
    "proRataBasis" "ProRataBasis" NOT NULL DEFAULT 'MONTH',
    "proRataCutoffDay" INTEGER NOT NULL DEFAULT 15,
    "remindersEnabled" BOOLEAN NOT NULL DEFAULT true,
    "reminderDaysBefore" INTEGER NOT NULL DEFAULT 7,
    "reminderDaysAfter" INTEGER[] DEFAULT ARRAY[7, 21, 45]::INTEGER[],
    "holdReportCards" BOOLEAN NOT NULL DEFAULT false,
    "holdAfterDays" INTEGER NOT NULL DEFAULT 30,
    "onlinePayments" BOOLEAN NOT NULL DEFAULT false,
    "bankDetailsEn" TEXT,
    "bankDetailsAr" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FinanceSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeeItem" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "academicYearId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "kind" "FeeItemKind" NOT NULL,
    "nameEn" TEXT NOT NULL,
    "nameAr" TEXT NOT NULL,
    "amountFils" INTEGER NOT NULL,
    "gradeLevels" INTEGER[],
    "zone" TEXT,
    "recurring" BOOLEAN NOT NULL DEFAULT false,
    "proRata" BOOLEAN NOT NULL DEFAULT false,
    "discountable" BOOLEAN NOT NULL DEFAULT false,
    "autoBill" BOOLEAN NOT NULL DEFAULT false,
    "vatTreatment" "VatTreatment" NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FeeItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InstalmentPlan" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "academicYearId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL,
    "nameAr" TEXT NOT NULL,
    "kind" "InstalmentPlanKind" NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InstalmentPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InstalmentPart" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "labelEn" TEXT NOT NULL,
    "labelAr" TEXT NOT NULL,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "shareBp" INTEGER NOT NULL,

    CONSTRAINT "InstalmentPart_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeeDiscount" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "kind" "FeeDiscountKind" NOT NULL,
    "nameEn" TEXT NOT NULL,
    "nameAr" TEXT NOT NULL,
    "method" "DiscountMethod" NOT NULL,
    "percentBp" INTEGER,
    "amountFils" INTEGER,
    "requiresApproval" BOOLEAN NOT NULL DEFAULT true,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FeeDiscount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeeAward" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "discountId" TEXT NOT NULL,
    "academicYearId" TEXT NOT NULL,
    "status" "FeeAwardStatus" NOT NULL DEFAULT 'PENDING',
    "reason" TEXT,
    "requestedById" TEXT,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FeeAward_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeeAccount" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL,
    "nameAr" TEXT NOT NULL,
    "payerType" "FeePayerType" NOT NULL DEFAULT 'GUARDIAN',
    "payerGuardianId" TEXT,
    "sponsorName" TEXT,
    "sponsorTrn" TEXT,
    "billingAddress" TEXT,
    "billingEmail" TEXT,
    "planKey" TEXT,
    "remindersPaused" BOOLEAN NOT NULL DEFAULT false,
    "pausedReason" TEXT,
    "applicationRef" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FeeAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StudentFeeProfile" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "transportZone" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StudentFeeProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeeCharge" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "studentId" TEXT,
    "feeItemId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "unitFils" INTEGER NOT NULL,
    "descriptionEn" TEXT,
    "descriptionAr" TEXT,
    "invoiceId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FeeCharge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invoice" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "kind" "InvoiceKind" NOT NULL,
    "number" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "academicYearId" TEXT,
    "billingRunId" TEXT,
    "planPartId" TEXT,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'OPEN',
    "issueDate" TIMESTAMP(3) NOT NULL,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "periodStart" TIMESTAMP(3),
    "periodEnd" TIMESTAMP(3),
    "periodLabelEn" TEXT,
    "periodLabelAr" TEXT,
    "billToName" TEXT NOT NULL,
    "billToNameAr" TEXT,
    "billToAddress" TEXT,
    "billToTrn" TEXT,
    "billToEmail" TEXT,
    "seller" JSONB NOT NULL,
    "subtotalFils" INTEGER NOT NULL,
    "discountFils" INTEGER NOT NULL,
    "netFils" INTEGER NOT NULL,
    "vatFils" INTEGER NOT NULL,
    "totalFils" INTEGER NOT NULL,
    "paidFils" INTEGER NOT NULL DEFAULT 0,
    "creditedFils" INTEGER NOT NULL DEFAULT 0,
    "convertedToId" TEXT,
    "sourceRef" TEXT,
    "remindersSent" INTEGER NOT NULL DEFAULT 0,
    "lastReminderAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvoiceLine" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "studentId" TEXT,
    "feeItemId" TEXT,
    "kind" "FeeItemKind" NOT NULL,
    "descriptionEn" TEXT NOT NULL,
    "descriptionAr" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitFils" INTEGER NOT NULL,
    "grossFils" INTEGER NOT NULL,
    "discountFils" INTEGER NOT NULL,
    "netFils" INTEGER NOT NULL,
    "vatTreatment" "VatTreatment" NOT NULL,
    "vatRateBp" INTEGER NOT NULL,
    "vatFils" INTEGER NOT NULL,
    "totalFils" INTEGER NOT NULL,
    "prorataNum" INTEGER NOT NULL DEFAULT 1,
    "prorataDen" INTEGER NOT NULL DEFAULT 1,
    "discounts" JSONB,

    CONSTRAINT "InvoiceLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreditNote" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "issueDate" TIMESTAMP(3) NOT NULL,
    "reasonKind" TEXT NOT NULL,
    "reasonEn" TEXT NOT NULL,
    "reasonAr" TEXT,
    "netFils" INTEGER NOT NULL,
    "vatFils" INTEGER NOT NULL,
    "totalFils" INTEGER NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CreditNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreditNoteLine" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "creditNoteId" TEXT NOT NULL,
    "invoiceLineId" TEXT,
    "descriptionEn" TEXT NOT NULL,
    "descriptionAr" TEXT NOT NULL,
    "netFils" INTEGER NOT NULL,
    "vatTreatment" "VatTreatment" NOT NULL,
    "vatRateBp" INTEGER NOT NULL,
    "vatFils" INTEGER NOT NULL,
    "totalFils" INTEGER NOT NULL,

    CONSTRAINT "CreditNoteLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeePayment" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "number" TEXT,
    "method" "FeePaymentMethod" NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'manual',
    "status" "FeePaymentStatus" NOT NULL,
    "amountFils" INTEGER NOT NULL,
    "allocatedFils" INTEGER NOT NULL DEFAULT 0,
    "refundedFils" INTEGER NOT NULL DEFAULT 0,
    "receivedAt" TIMESTAMP(3) NOT NULL,
    "clearedAt" TIMESTAMP(3),
    "bouncedAt" TIMESTAMP(3),
    "reference" TEXT,
    "chequeNumber" TEXT,
    "chequeBank" TEXT,
    "chequeDate" TIMESTAMP(3),
    "payerName" TEXT,
    "notes" TEXT,
    "externalId" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "recordedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FeePayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeeAllocation" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "paymentId" TEXT,
    "creditNoteId" TEXT,
    "amountFils" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FeeAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeeRefund" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "number" TEXT,
    "accountId" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "amountFils" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "RefundStatus" NOT NULL DEFAULT 'REQUESTED',
    "requestedById" TEXT,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "paidAt" TIMESTAMP(3),
    "method" "FeePaymentMethod",
    "reference" TEXT,

    CONSTRAINT "FeeRefund_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentLink" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "invoiceId" TEXT,
    "amountFils" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'AED',
    "provider" TEXT NOT NULL,
    "status" "PaymentLinkStatus" NOT NULL DEFAULT 'OPEN',
    "externalId" TEXT,
    "url" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "paymentId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paidAt" TIMESTAMP(3),

    CONSTRAINT "PaymentLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentEvent" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "linkId" TEXT,
    "outcome" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BillingRun" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "academicYearId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "partId" TEXT NOT NULL,
    "status" "BillingRunStatus" NOT NULL DEFAULT 'QUEUED',
    "issueDate" TIMESTAMP(3) NOT NULL,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "includeCharges" BOOLEAN NOT NULL DEFAULT true,
    "totalAccounts" INTEGER NOT NULL DEFAULT 0,
    "processed" INTEGER NOT NULL DEFAULT 0,
    "invoicesCreated" INTEGER NOT NULL DEFAULT 0,
    "skipped" INTEGER NOT NULL DEFAULT 0,
    "totalFils" INTEGER NOT NULL DEFAULT 0,
    "cursor" TEXT,
    "error" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BillingRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FinanceSettings_orgId_key" ON "FinanceSettings"("orgId");

-- CreateIndex
CREATE INDEX "FeeItem_orgId_academicYearId_kind_idx" ON "FeeItem"("orgId", "academicYearId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "FeeItem_orgId_academicYearId_code_key" ON "FeeItem"("orgId", "academicYearId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "InstalmentPlan_orgId_academicYearId_key_key" ON "InstalmentPlan"("orgId", "academicYearId", "key");

-- CreateIndex
CREATE INDEX "InstalmentPart_orgId_idx" ON "InstalmentPart"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "InstalmentPart_planId_seq_key" ON "InstalmentPart"("planId", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "FeeDiscount_orgId_code_key" ON "FeeDiscount"("orgId", "code");

-- CreateIndex
CREATE INDEX "FeeAward_orgId_studentId_academicYearId_idx" ON "FeeAward"("orgId", "studentId", "academicYearId");

-- CreateIndex
CREATE INDEX "FeeAward_orgId_status_idx" ON "FeeAward"("orgId", "status");

-- CreateIndex
CREATE INDEX "FeeAccount_orgId_payerGuardianId_idx" ON "FeeAccount"("orgId", "payerGuardianId");

-- CreateIndex
CREATE INDEX "FeeAccount_orgId_applicationRef_idx" ON "FeeAccount"("orgId", "applicationRef");

-- CreateIndex
CREATE INDEX "FeeAccount_orgId_nameEn_idx" ON "FeeAccount"("orgId", "nameEn");

-- CreateIndex
CREATE UNIQUE INDEX "FeeAccount_orgId_code_key" ON "FeeAccount"("orgId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "StudentFeeProfile_studentId_key" ON "StudentFeeProfile"("studentId");

-- CreateIndex
CREATE INDEX "StudentFeeProfile_orgId_accountId_idx" ON "StudentFeeProfile"("orgId", "accountId");

-- CreateIndex
CREATE INDEX "FeeCharge_orgId_accountId_invoiceId_idx" ON "FeeCharge"("orgId", "accountId", "invoiceId");

-- CreateIndex
CREATE INDEX "Invoice_orgId_accountId_issueDate_idx" ON "Invoice"("orgId", "accountId", "issueDate");

-- CreateIndex
CREATE INDEX "Invoice_orgId_status_dueDate_idx" ON "Invoice"("orgId", "status", "dueDate");

-- CreateIndex
CREATE INDEX "Invoice_orgId_issueDate_idx" ON "Invoice"("orgId", "issueDate");

-- CreateIndex
CREATE INDEX "Invoice_orgId_sourceRef_idx" ON "Invoice"("orgId", "sourceRef");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_orgId_number_key" ON "Invoice"("orgId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_billingRunId_accountId_key" ON "Invoice"("billingRunId", "accountId");

-- CreateIndex
CREATE INDEX "InvoiceLine_orgId_invoiceId_idx" ON "InvoiceLine"("orgId", "invoiceId");

-- CreateIndex
CREATE INDEX "InvoiceLine_orgId_studentId_idx" ON "InvoiceLine"("orgId", "studentId");

-- CreateIndex
CREATE INDEX "CreditNote_orgId_accountId_idx" ON "CreditNote"("orgId", "accountId");

-- CreateIndex
CREATE INDEX "CreditNote_orgId_invoiceId_idx" ON "CreditNote"("orgId", "invoiceId");

-- CreateIndex
CREATE INDEX "CreditNote_orgId_issueDate_idx" ON "CreditNote"("orgId", "issueDate");

-- CreateIndex
CREATE UNIQUE INDEX "CreditNote_orgId_number_key" ON "CreditNote"("orgId", "number");

-- CreateIndex
CREATE INDEX "CreditNoteLine_orgId_creditNoteId_idx" ON "CreditNoteLine"("orgId", "creditNoteId");

-- CreateIndex
CREATE INDEX "FeePayment_orgId_accountId_idx" ON "FeePayment"("orgId", "accountId");

-- CreateIndex
CREATE INDEX "FeePayment_orgId_status_chequeDate_idx" ON "FeePayment"("orgId", "status", "chequeDate");

-- CreateIndex
CREATE INDEX "FeePayment_orgId_receivedAt_idx" ON "FeePayment"("orgId", "receivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "FeePayment_orgId_number_key" ON "FeePayment"("orgId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "FeePayment_orgId_idempotencyKey_key" ON "FeePayment"("orgId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "FeeAllocation_orgId_invoiceId_idx" ON "FeeAllocation"("orgId", "invoiceId");

-- CreateIndex
CREATE INDEX "FeeAllocation_orgId_paymentId_idx" ON "FeeAllocation"("orgId", "paymentId");

-- CreateIndex
CREATE INDEX "FeeRefund_orgId_status_idx" ON "FeeRefund"("orgId", "status");

-- CreateIndex
CREATE INDEX "FeeRefund_orgId_accountId_idx" ON "FeeRefund"("orgId", "accountId");

-- CreateIndex
CREATE UNIQUE INDEX "FeeRefund_orgId_number_key" ON "FeeRefund"("orgId", "number");

-- CreateIndex
CREATE INDEX "PaymentLink_orgId_invoiceId_idx" ON "PaymentLink"("orgId", "invoiceId");

-- CreateIndex
CREATE INDEX "PaymentLink_orgId_accountId_idx" ON "PaymentLink"("orgId", "accountId");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentEvent_orgId_provider_eventId_key" ON "PaymentEvent"("orgId", "provider", "eventId");

-- CreateIndex
CREATE INDEX "BillingRun_orgId_createdAt_idx" ON "BillingRun"("orgId", "createdAt");

-- CreateIndex
CREATE INDEX "BillingRun_status_updatedAt_idx" ON "BillingRun"("status", "updatedAt");

-- AddForeignKey
ALTER TABLE "InstalmentPart" ADD CONSTRAINT "InstalmentPart_planId_fkey" FOREIGN KEY ("planId") REFERENCES "InstalmentPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeeAward" ADD CONSTRAINT "FeeAward_discountId_fkey" FOREIGN KEY ("discountId") REFERENCES "FeeDiscount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentFeeProfile" ADD CONSTRAINT "StudentFeeProfile_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "FeeAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceLine" ADD CONSTRAINT "InvoiceLine_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditNoteLine" ADD CONSTRAINT "CreditNoteLine_creditNoteId_fkey" FOREIGN KEY ("creditNoteId") REFERENCES "CreditNote"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Money invariants. Amounts are integers of fils.
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_amounts_check"
  CHECK ("totalFils" >= 0 AND "paidFils" >= 0 AND "creditedFils" >= 0 AND "paidFils" + "creditedFils" <= "totalFils");
ALTER TABLE "FeePayment" ADD CONSTRAINT "FeePayment_amounts_check"
  CHECK ("amountFils" > 0 AND "allocatedFils" >= 0 AND "refundedFils" >= 0 AND "allocatedFils" + "refundedFils" <= "amountFils");
ALTER TABLE "FeeRefund" ADD CONSTRAINT "FeeRefund_amount_check" CHECK ("amountFils" > 0);
ALTER TABLE "PaymentLink" ADD CONSTRAINT "PaymentLink_amount_check" CHECK ("amountFils" > 0);
ALTER TABLE "InstalmentPart" ADD CONSTRAINT "InstalmentPart_share_check" CHECK ("shareBp" >= 0 AND "shareBp" <= 10000);

-- An issued invoice never changes: only its payment state (status, paid and credited amounts, reminders and the
-- proforma conversion link) may move. Corrections are credit notes.
CREATE OR REPLACE FUNCTION fees_invoice_immutable() RETURNS trigger AS $$
BEGIN
  IF NEW."orgId" IS DISTINCT FROM OLD."orgId"
     OR NEW."kind" IS DISTINCT FROM OLD."kind"
     OR NEW."number" IS DISTINCT FROM OLD."number"
     OR NEW."accountId" IS DISTINCT FROM OLD."accountId"
     OR NEW."issueDate" IS DISTINCT FROM OLD."issueDate"
     OR NEW."dueDate" IS DISTINCT FROM OLD."dueDate"
     OR NEW."billToName" IS DISTINCT FROM OLD."billToName"
     OR NEW."billToNameAr" IS DISTINCT FROM OLD."billToNameAr"
     OR NEW."billToAddress" IS DISTINCT FROM OLD."billToAddress"
     OR NEW."billToTrn" IS DISTINCT FROM OLD."billToTrn"
     OR NEW."seller"::text IS DISTINCT FROM OLD."seller"::text
     OR NEW."subtotalFils" IS DISTINCT FROM OLD."subtotalFils"
     OR NEW."discountFils" IS DISTINCT FROM OLD."discountFils"
     OR NEW."netFils" IS DISTINCT FROM OLD."netFils"
     OR NEW."vatFils" IS DISTINCT FROM OLD."vatFils"
     OR NEW."totalFils" IS DISTINCT FROM OLD."totalFils" THEN
    RAISE EXCEPTION 'An issued invoice cannot be changed; issue a credit note instead' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "Invoice_immutable" BEFORE UPDATE ON "Invoice" FOR EACH ROW EXECUTE FUNCTION fees_invoice_immutable();

-- The built-in Finance officer role for schools that already exist (new schools get it from the starter template).
-- Permissions are kept in step with src/server/identity/permissions.ts by the role sync in npm run db:migrate.
INSERT INTO "Role" ("id", "orgId", "key", "nameEn", "nameAr", "descEn", "descAr", "permissions", "isSystem", "customized", "createdAt", "updatedAt")
SELECT 'r' || substr(md5(o."id" || ':finance_officer'), 1, 24), o."id", 'finance_officer', 'Finance Officer', 'مسؤول الشؤون المالية',
       'Sets up fees, bills families, records payments and runs finance reports.',
       'يعدّ الرسوم ويصدر فواتير الأسر ويسجّل المدفوعات ويستخرج التقارير المالية.',
       ARRAY['absence.report','services.use','people.view','safeguarding.refer','tasks.use','appointments.book','calendar.view','documents.view','ai.use','comms.send','cases.view','fees.view','fees.manage','fees.collect','fees.reports'],
       true, false, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "Organization" o
WHERE NOT EXISTS (SELECT 1 FROM "Role" r WHERE r."orgId" = o."id" AND r."key" = 'finance_officer');
