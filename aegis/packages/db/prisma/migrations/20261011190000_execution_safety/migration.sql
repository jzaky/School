-- Execution safety: one live grant per request, explicit executing/unknown states, downstream idempotency.
ALTER TYPE "ActionRequestStatus" ADD VALUE IF NOT EXISTS 'executing';
ALTER TYPE "ActionRequestStatus" ADD VALUE IF NOT EXISTS 'unknown';
ALTER TYPE "ReceiptStatus" ADD VALUE IF NOT EXISTS 'unknown';

ALTER TABLE "action_requests"
  ADD COLUMN "execution_started_at" TIMESTAMP(3),
  ADD COLUMN "execution_attempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "downstream_idempotency_key" TEXT;

ALTER TABLE "execution_grants"
  ADD COLUMN "voided_at" TIMESTAMP(3),
  ADD COLUMN "void_reason" TEXT;
CREATE INDEX "execution_grants_action_request_id_idx" ON "execution_grants"("action_request_id");
-- At most one live (unconsumed, unvoided) grant per action request. The application voids expired grants
-- before issuing a new one; the index makes the invariant hold even under concurrent issuance.
CREATE UNIQUE INDEX "execution_grants_one_live_per_request" ON "execution_grants"("action_request_id") WHERE "consumed_at" IS NULL AND "voided_at" IS NULL;

ALTER TABLE "execution_receipts" ADD COLUMN "attempt" INTEGER NOT NULL DEFAULT 1;
CREATE INDEX "execution_receipts_action_request_id_created_at_idx" ON "execution_receipts"("action_request_id", "created_at");
