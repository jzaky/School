-- Uncertainty governance (Phase 4). Row-level security is applied by prisma/rls.sql.
ALTER TABLE "tools" ADD COLUMN "uncertainty_policy" JSONB NOT NULL DEFAULT '{}';
ALTER TABLE "authorization_decisions" ADD COLUMN "uncertainty_level" TEXT;

CREATE TABLE "outcome_labels" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "action_request_id" UUID NOT NULL,
    "agent_id" UUID NOT NULL,
    "tool_key" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION,
    "correct" BOOLEAN NOT NULL,
    "source" TEXT NOT NULL,
    "labelled_by" TEXT,
    "note" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "outcome_labels_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "outcome_labels_action_request_id_source_key" ON "outcome_labels"("action_request_id", "source");
CREATE INDEX "outcome_labels_org_id_agent_id_created_at_idx" ON "outcome_labels"("org_id", "agent_id", "created_at");

CREATE TABLE "calibration_profiles" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "agent_id" UUID NOT NULL,
    "tool_key" TEXT NOT NULL,
    "sample_size" INTEGER NOT NULL,
    "ece" DOUBLE PRECISION,
    "brier" DOUBLE PRECISION,
    "accuracy" DOUBLE PRECISION,
    "bins" JSONB NOT NULL DEFAULT '[]',
    "window_days" INTEGER NOT NULL,
    "computed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "calibration_profiles_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "calibration_profiles_org_id_agent_id_tool_key_key" ON "calibration_profiles"("org_id", "agent_id", "tool_key");
