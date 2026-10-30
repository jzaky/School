-- CreateTable
CREATE TABLE "ai_gateway_events" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "principal_type" TEXT NOT NULL,
    "principal_id" UUID NOT NULL,
    "api_key_id" UUID,
    "claimed_user" TEXT,
    "provider_id" UUID,
    "provider_key" TEXT,
    "model" TEXT NOT NULL,
    "decision" TEXT NOT NULL,
    "basis" TEXT NOT NULL,
    "reasons" JSONB NOT NULL DEFAULT '[]',
    "policy_version_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "prompt_classes" JSONB NOT NULL DEFAULT '[]',
    "response_classes" JSONB NOT NULL DEFAULT '[]',
    "prompt_hash" TEXT NOT NULL,
    "prompt_chars" INTEGER NOT NULL,
    "message_count" INTEGER NOT NULL,
    "forwarded" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL,
    "upstream_status" INTEGER,
    "response_withheld" BOOLEAN NOT NULL DEFAULT false,
    "latency_ms" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "ai_gateway_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ai_gateway_events_org_id_created_at_idx" ON "ai_gateway_events"("org_id", "created_at");

-- CreateIndex
CREATE INDEX "ai_gateway_events_org_id_decision_idx" ON "ai_gateway_events"("org_id", "decision");

