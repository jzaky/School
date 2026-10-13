-- Managed autonomy (Phase 3). Row-level security and the append-only trigger are applied by prisma/rls.sql.
CREATE TYPE "AutonomyTransitionKind" AS ENUM ('lowered', 'raised', 'automatic_downgrade');
CREATE TYPE "AutonomyChangeStatus" AS ENUM ('pending', 'approved', 'rejected', 'expired', 'cancelled');

ALTER TABLE "agents" ADD COLUMN "autonomy_level" INTEGER NOT NULL DEFAULT 4,
ADD COLUMN "autonomy_ceiling_amount" DECIMAL(18,2),
ADD COLUMN "autonomy_changed_at" TIMESTAMP(3);
ALTER TABLE "agents" ADD CONSTRAINT "agents_autonomy_level_range" CHECK ("autonomy_level" BETWEEN 0 AND 4);

CREATE TABLE "autonomy_transitions" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "agent_id" UUID NOT NULL,
    "from_level" INTEGER NOT NULL,
    "to_level" INTEGER NOT NULL,
    "kind" "AutonomyTransitionKind" NOT NULL,
    "reason" TEXT NOT NULL,
    "trigger" JSONB,
    "actor_type" TEXT NOT NULL,
    "actor_id" TEXT,
    "change_request_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "autonomy_transitions_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "autonomy_transitions_org_id_agent_id_created_at_idx" ON "autonomy_transitions"("org_id", "agent_id", "created_at");
CREATE INDEX "autonomy_transitions_org_id_created_at_idx" ON "autonomy_transitions"("org_id", "created_at");

CREATE TABLE "autonomy_change_requests" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "agent_id" UUID NOT NULL,
    "from_level" INTEGER NOT NULL,
    "to_level" INTEGER NOT NULL,
    "ceiling_amount" DECIMAL(18,2),
    "reason" TEXT NOT NULL,
    "status" "AutonomyChangeStatus" NOT NULL DEFAULT 'pending',
    "requested_by" UUID NOT NULL,
    "decided_by" UUID,
    "decided_at" TIMESTAMP(3),
    "decision_note" TEXT,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "autonomy_change_requests_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "autonomy_change_requests_org_id_status_idx" ON "autonomy_change_requests"("org_id", "status");
CREATE INDEX "autonomy_change_requests_org_id_agent_id_idx" ON "autonomy_change_requests"("org_id", "agent_id");
