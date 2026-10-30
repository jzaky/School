-- CreateTable
CREATE TABLE "shadow_ai_apps" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "vendor" TEXT NOT NULL DEFAULT '',
    "category" TEXT NOT NULL DEFAULT 'chat',
    "domains" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "processes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "custom" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'unreviewed',
    "note" TEXT NOT NULL DEFAULT '',
    "controls" JSONB NOT NULL DEFAULT '{}',
    "reviewed_by" UUID,
    "reviewed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shadow_ai_apps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "discovery_signals" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "import_id" UUID,
    "source" TEXT NOT NULL,
    "source_type" TEXT NOT NULL,
    "confidence" TEXT NOT NULL,
    "app_key" TEXT,
    "domain" TEXT,
    "process" TEXT,
    "user_id" UUID,
    "identity_hash" TEXT,
    "device_hash" TEXT,
    "occurred_at" TIMESTAMP(3) NOT NULL,
    "dedupe_key" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "discovery_signals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "discovery_imports" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "source" TEXT NOT NULL,
    "format" TEXT NOT NULL,
    "label" TEXT NOT NULL DEFAULT '',
    "received" INTEGER NOT NULL DEFAULT 0,
    "accepted" INTEGER NOT NULL DEFAULT 0,
    "matched" INTEGER NOT NULL DEFAULT 0,
    "duplicates" INTEGER NOT NULL DEFAULT 0,
    "unmatched" INTEGER NOT NULL DEFAULT 0,
    "rejected" INTEGER NOT NULL DEFAULT 0,
    "unmatched_top" JSONB NOT NULL DEFAULT '[]',
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "discovery_imports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "shadow_ai_apps_org_id_status_idx" ON "shadow_ai_apps"("org_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "shadow_ai_apps_org_id_key_key" ON "shadow_ai_apps"("org_id", "key");

-- CreateIndex
CREATE INDEX "discovery_signals_org_id_app_key_occurred_at_idx" ON "discovery_signals"("org_id", "app_key", "occurred_at");

-- CreateIndex
CREATE INDEX "discovery_signals_org_id_source_type_occurred_at_idx" ON "discovery_signals"("org_id", "source_type", "occurred_at");

-- CreateIndex
CREATE UNIQUE INDEX "discovery_signals_org_id_dedupe_key_key" ON "discovery_signals"("org_id", "dedupe_key");

-- CreateIndex
CREATE INDEX "discovery_imports_org_id_created_at_idx" ON "discovery_imports"("org_id", "created_at");

