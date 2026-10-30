-- Event destinations and deliveries (Phase 8). Row-level security is applied by prisma/rls.sql.
-- CreateTable
CREATE TABLE "event_destinations" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "categories" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "min_severity" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "config" JSONB NOT NULL DEFAULT '{}',
    "secret_envelope" TEXT NOT NULL,
    "cursor_seq" BIGINT NOT NULL DEFAULT 0,
    "dispatch_locked_until" TIMESTAMP(3),
    "last_delivered_at" TIMESTAMP(3),
    "last_error" TEXT,
    "verified_at" TIMESTAMP(3),
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "event_destinations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "event_deliveries" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "destination_id" UUID NOT NULL,
    "evidence_event_id" UUID,
    "event_type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "response_status" INTEGER,
    "last_error" TEXT,
    "delivered_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "event_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "event_destinations_org_id_enabled_idx" ON "event_destinations"("org_id", "enabled");

-- CreateIndex
CREATE INDEX "event_deliveries_org_id_status_next_attempt_at_idx" ON "event_deliveries"("org_id", "status", "next_attempt_at");

-- CreateIndex
CREATE INDEX "event_deliveries_destination_id_created_at_idx" ON "event_deliveries"("destination_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "event_deliveries_destination_id_evidence_event_id_key" ON "event_deliveries"("destination_id", "evidence_event_id");

-- AddForeignKey
ALTER TABLE "event_deliveries" ADD CONSTRAINT "event_deliveries_destination_id_fkey" FOREIGN KEY ("destination_id") REFERENCES "event_destinations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

