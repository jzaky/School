-- Expense receipt validation (docs/RECEIPT_VALIDATION.md): card and bank transactions from the system of record,
-- and expense claims with their receipt evidence, verdict and findings. Row-level security is applied by rls.sql
-- to every table with a NOT NULL org_id.

-- CreateTable
CREATE TABLE "financial_transactions" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "ref" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "card_ref" TEXT,
    "merchant_name" TEXT NOT NULL,
    "amount_minor" BIGINT NOT NULL,
    "currency" TEXT NOT NULL,
    "posted_at" TIMESTAMP(3) NOT NULL,
    "original_ref" TEXT,
    "source_type" TEXT NOT NULL,
    "source_id" UUID,
    "source_label" TEXT,
    "detail" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "financial_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expense_claims" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "ref" TEXT NOT NULL,
    "claimant_ref" TEXT NOT NULL,
    "card_ref" TEXT,
    "merchant_name" TEXT NOT NULL,
    "receipt_date" TIMESTAMP(3) NOT NULL,
    "currency" TEXT NOT NULL,
    "subtotal_minor" BIGINT,
    "vat_minor" BIGINT,
    "total_minor" BIGINT NOT NULL,
    "claimed_minor" BIGINT NOT NULL,
    "trn" TEXT,
    "jurisdiction" TEXT NOT NULL,
    "receipt_sha256" TEXT,
    "receipt_dhash" TEXT,
    "receipt_meta" JSONB NOT NULL DEFAULT '{}',
    "verdict" TEXT NOT NULL,
    "findings" JSONB NOT NULL DEFAULT '[]',
    "matched_refs" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "reserved_by_request_id" UUID,
    "reserved_at" TIMESTAMP(3),
    "source_type" TEXT NOT NULL,
    "source_id" UUID,
    "source_label" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "expense_claims_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "financial_transactions_org_id_ref_key" ON "financial_transactions"("org_id", "ref");
CREATE INDEX "financial_transactions_org_id_posted_at_idx" ON "financial_transactions"("org_id", "posted_at");
CREATE UNIQUE INDEX "expense_claims_org_id_ref_key" ON "expense_claims"("org_id", "ref");
CREATE INDEX "expense_claims_org_id_receipt_sha256_idx" ON "expense_claims"("org_id", "receipt_sha256");
