-- Policy exceptions (Phase 9). Row-level security is applied by prisma/rls.sql.
-- CreateEnum
CREATE TYPE "PolicyExceptionStatus" AS ENUM ('requested', 'approved', 'rejected', 'revoked');

-- CreateTable
CREATE TABLE "policy_exceptions" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "policy_id" UUID NOT NULL,
    "policy_key" TEXT NOT NULL,
    "rule_id" TEXT NOT NULL,
    "agent_id" UUID NOT NULL,
    "tool_key" TEXT,
    "reason" TEXT NOT NULL,
    "status" "PolicyExceptionStatus" NOT NULL DEFAULT 'requested',
    "starts_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "requested_by" UUID,
    "decided_by" UUID,
    "decided_at" TIMESTAMP(3),
    "decision_note" TEXT,
    "revoked_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "policy_exceptions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "policy_exceptions_org_id_agent_id_status_idx" ON "policy_exceptions"("org_id", "agent_id", "status");

-- CreateIndex
CREATE INDEX "policy_exceptions_org_id_policy_id_idx" ON "policy_exceptions"("org_id", "policy_id");

