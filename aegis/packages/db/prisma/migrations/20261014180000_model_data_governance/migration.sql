-- Model and data governance, regulatory change (Phase 7). Row-level security and append-only triggers are applied by prisma/rls.sql.
-- CreateEnum
CREATE TYPE "ModelStage" AS ENUM ('proposed', 'evaluating', 'approved', 'deprecated', 'retired');

-- CreateEnum
CREATE TYPE "DeletionRequestStatus" AS ENUM ('requested', 'approved', 'rejected', 'completed');

-- CreateEnum
CREATE TYPE "RegulatoryChangeStatus" AS ENUM ('new', 'assessing', 'action_required', 'implemented', 'not_applicable');

-- AlterTable
ALTER TABLE "agents" ADD COLUMN     "model_record_id" UUID;

-- CreateTable
CREATE TABLE "ai_models" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "provider_model_id" TEXT NOT NULL,
    "version" TEXT NOT NULL DEFAULT '',
    "stage" "ModelStage" NOT NULL DEFAULT 'proposed',
    "risk_tier" TEXT NOT NULL DEFAULT 'medium',
    "intended_use" TEXT NOT NULL DEFAULT '',
    "limitations" TEXT NOT NULL DEFAULT '',
    "data_categories" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "hosting_region" TEXT NOT NULL DEFAULT '',
    "owner_id" UUID,
    "approval_requested_by" UUID,
    "approved_by" UUID,
    "approved_at" TIMESTAMP(3),
    "review_due_at" TIMESTAMP(3),
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_models_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "model_evaluations" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "model_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "result" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "metrics" JSONB NOT NULL DEFAULT '{}',
    "document_id" UUID,
    "recorded_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "model_evaluations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "model_stage_changes" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "model_id" UUID NOT NULL,
    "from_stage" "ModelStage" NOT NULL,
    "to_stage" "ModelStage" NOT NULL,
    "reason" TEXT NOT NULL,
    "actor_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "model_stage_changes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "datasets" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "owner_id" UUID,
    "classification" "DataClassification" NOT NULL DEFAULT 'internal',
    "categories" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "resource_id" UUID,
    "storage_location" TEXT NOT NULL DEFAULT '',
    "region" TEXT NOT NULL DEFAULT '',
    "retention_days" INTEGER,
    "lawful_basis" TEXT NOT NULL DEFAULT '',
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "datasets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "data_deletion_requests" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "dataset_id" UUID NOT NULL,
    "subject_ref_hash" TEXT NOT NULL,
    "subject_hint" TEXT NOT NULL DEFAULT '',
    "reason" TEXT NOT NULL,
    "status" "DeletionRequestStatus" NOT NULL DEFAULT 'requested',
    "due_at" TIMESTAMP(3) NOT NULL,
    "requested_by" UUID,
    "decided_by" UUID,
    "decided_at" TIMESTAMP(3),
    "decision_note" TEXT,
    "completed_by" UUID,
    "completed_at" TIMESTAMP(3),
    "completion_reference" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "data_deletion_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "regulatory_changes" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "reference" TEXT NOT NULL DEFAULT '',
    "jurisdiction" TEXT NOT NULL DEFAULT '',
    "framework_id" UUID,
    "published_at" TIMESTAMP(3),
    "effective_at" TIMESTAMP(3),
    "summary" TEXT NOT NULL DEFAULT '',
    "status" "RegulatoryChangeStatus" NOT NULL DEFAULT 'new',
    "impact" JSONB NOT NULL DEFAULT '{}',
    "assessed_by" UUID,
    "assessed_at" TIMESTAMP(3),
    "decision_note" TEXT,
    "remediation_task_ids" UUID[] DEFAULT ARRAY[]::UUID[],
    "owner_id" UUID,
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "regulatory_changes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ai_models_org_id_stage_idx" ON "ai_models"("org_id", "stage");

-- CreateIndex
CREATE UNIQUE INDEX "ai_models_org_id_key_key" ON "ai_models"("org_id", "key");

-- CreateIndex
CREATE INDEX "model_evaluations_org_id_model_id_idx" ON "model_evaluations"("org_id", "model_id");

-- CreateIndex
CREATE INDEX "model_stage_changes_org_id_model_id_created_at_idx" ON "model_stage_changes"("org_id", "model_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "datasets_org_id_key_key" ON "datasets"("org_id", "key");

-- CreateIndex
CREATE INDEX "data_deletion_requests_org_id_status_idx" ON "data_deletion_requests"("org_id", "status");

-- CreateIndex
CREATE INDEX "regulatory_changes_org_id_status_idx" ON "regulatory_changes"("org_id", "status");

-- CreateIndex
CREATE INDEX "regulatory_changes_org_id_effective_at_idx" ON "regulatory_changes"("org_id", "effective_at");

-- AddForeignKey
ALTER TABLE "model_evaluations" ADD CONSTRAINT "model_evaluations_model_id_fkey" FOREIGN KEY ("model_id") REFERENCES "ai_models"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "model_stage_changes" ADD CONSTRAINT "model_stage_changes_model_id_fkey" FOREIGN KEY ("model_id") REFERENCES "ai_models"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "data_deletion_requests" ADD CONSTRAINT "data_deletion_requests_dataset_id_fkey" FOREIGN KEY ("dataset_id") REFERENCES "datasets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

