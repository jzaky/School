-- Gateway outcomes RESTRICT, QUARANTINE and REQUEST_MORE_INFORMATION, integration-bound grants,
-- agent-to-agent delegation, enforcement-path audit summary.
ALTER TYPE "DecisionResult" ADD VALUE IF NOT EXISTS 'restrict';
ALTER TYPE "DecisionResult" ADD VALUE IF NOT EXISTS 'quarantine';
ALTER TYPE "DecisionResult" ADD VALUE IF NOT EXISTS 'request_more_information';
ALTER TYPE "ActionRequestStatus" ADD VALUE IF NOT EXISTS 'quarantined';
ALTER TYPE "ActionRequestStatus" ADD VALUE IF NOT EXISTS 'awaiting_information';

CREATE TABLE "agent_delegations" (
  "id" UUID NOT NULL,
  "org_id" UUID NOT NULL,
  "delegator_agent_id" UUID NOT NULL,
  "delegate_agent_id" UUID NOT NULL,
  "tool_keys" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "constraints" JSONB NOT NULL DEFAULT '{}',
  "reason" TEXT NOT NULL DEFAULT '',
  "granted_by" UUID,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "revoked_at" TIMESTAMP(3),
  "revoked_reason" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "agent_delegations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "agent_delegations_delegator_agent_id_fkey" FOREIGN KEY ("delegator_agent_id") REFERENCES "agents"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "agent_delegations_delegate_agent_id_fkey" FOREIGN KEY ("delegate_agent_id") REFERENCES "agents"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "agent_delegations_org_id_delegate_agent_id_idx" ON "agent_delegations"("org_id", "delegate_agent_id");
CREATE INDEX "agent_delegations_org_id_delegator_agent_id_idx" ON "agent_delegations"("org_id", "delegator_agent_id");

ALTER TABLE "action_requests"
  ADD COLUMN "delegation_id" UUID,
  ADD COLUMN "on_behalf_of_agent_id" UUID,
  ADD CONSTRAINT "action_requests_delegation_id_fkey" FOREIGN KEY ("delegation_id") REFERENCES "agent_delegations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "execution_grants" ADD COLUMN "integration_id" UUID;

ALTER TABLE "integrations"
  ADD COLUMN "last_enforcement_audit_at" TIMESTAMP(3),
  ADD COLUMN "enforcement_summary" JSONB NOT NULL DEFAULT '{}';
