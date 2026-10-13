-- Agent identity: purpose, destinations, credential expiry; time-limited tool grants; access requests; discovery.
ALTER TABLE "agents"
  ADD COLUMN "purpose" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "allowed_destinations" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "credential_expires_at" TIMESTAMP(3);
ALTER TABLE "agent_tools" ADD COLUMN "expires_at" TIMESTAMP(3);

CREATE TYPE "AccessRequestStatus" AS ENUM ('pending', 'approved', 'rejected', 'expired', 'revoked');
CREATE TABLE "access_requests" (
  "id" UUID NOT NULL,
  "org_id" UUID NOT NULL,
  "agent_id" UUID NOT NULL,
  "tool_id" UUID,
  "resource_id" UUID,
  "actions" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "reason" TEXT NOT NULL,
  "duration_hours" INTEGER NOT NULL,
  "status" "AccessRequestStatus" NOT NULL DEFAULT 'pending',
  "requested_by" UUID NOT NULL,
  "decided_by" UUID,
  "decided_at" TIMESTAMP(3),
  "decision_note" TEXT,
  "expires_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "access_requests_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "access_requests_org_id_status_idx" ON "access_requests"("org_id", "status");
CREATE INDEX "access_requests_org_id_agent_id_idx" ON "access_requests"("org_id", "agent_id");

CREATE TYPE "DiscoveredAgentStatus" AS ENUM ('unregistered', 'linked', 'ignored');
CREATE TABLE "discovered_agents" (
  "id" UUID NOT NULL,
  "org_id" UUID NOT NULL,
  "source" TEXT NOT NULL,
  "external_id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "platform" TEXT NOT NULL DEFAULT '',
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "observations" INTEGER NOT NULL DEFAULT 1,
  "first_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "status" "DiscoveredAgentStatus" NOT NULL DEFAULT 'unregistered',
  "linked_agent_id" UUID,
  "decided_by" UUID,
  "note" TEXT,
  CONSTRAINT "discovered_agents_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "discovered_agents_org_id_source_external_id_key" ON "discovered_agents"("org_id", "source", "external_id");
CREATE INDEX "discovered_agents_org_id_status_idx" ON "discovered_agents"("org_id", "status");
