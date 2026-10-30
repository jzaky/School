-- Payment document matching (docs/PAYMENT_MATCHING.md): invoices, receipts and purchase orders registered
-- by the system of record, which a payment by an agent must match before money moves. Row-level security
-- is applied by rls.sql to every table with a NOT NULL org_id.

-- CreateTable
CREATE TABLE "payment_documents" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "ref" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "vendor_ref" TEXT NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "currency" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "source_type" TEXT NOT NULL,
    "source_id" UUID,
    "source_label" TEXT,
    "reserved_by_request_id" UUID,
    "reserved_at" TIMESTAMP(3),
    "detail" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payment_documents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "payment_documents_org_id_ref_key" ON "payment_documents"("org_id", "ref");

-- CreateIndex
CREATE INDEX "payment_documents_org_id_vendor_ref_idx" ON "payment_documents"("org_id", "vendor_ref");
