-- AlterTable
ALTER TABLE "DataSubjectRequest" ADD COLUMN     "guardianId" TEXT,
ADD COLUMN     "membershipId" TEXT;

-- AlterTable
ALTER TABLE "Guardian" ADD COLUMN     "anonymisedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Membership" ADD COLUMN     "anonymisedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "ProcessingPurpose" ADD COLUMN     "retentionPolicyId" TEXT,
ADD COLUMN     "updatedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Student" ADD COLUMN     "anonymisedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "DataExport" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'SCHOOL',
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "idempotencyKey" TEXT NOT NULL,
    "requestedById" TEXT NOT NULL,
    "storageKey" TEXT,
    "sizeBytes" INTEGER,
    "fileCount" INTEGER,
    "rowCount" INTEGER,
    "summary" JSONB,
    "error" TEXT,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "DataExport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlatformAuditEvent" (
    "id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "orgRef" TEXT NOT NULL,
    "actorUserId" TEXT,
    "meta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlatformAuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DataExport_orgId_createdAt_idx" ON "DataExport"("orgId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "DataExport_orgId_idempotencyKey_key" ON "DataExport"("orgId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "PlatformAuditEvent_createdAt_idx" ON "PlatformAuditEvent"("createdAt");

