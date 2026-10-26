-- Government registration of learners (for example SPEA DALEEL in Sharjah, MoE Al Manhal, KHDA, ADEK): a status,
-- the authority's reference number and the decision date, recorded by staff for each enrollment and each withdrawal.
-- The authority (and its shown name) is a per-school admissions setting.

-- AlterTable
ALTER TABLE "AdmissionSettings" ADD COLUMN     "authority" TEXT,
ADD COLUMN     "authorityLabelAr" TEXT,
ADD COLUMN     "authorityLabelEn" TEXT;

-- CreateTable
CREATE TABLE "GovRegistration" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'NOT_SUBMITTED',
    "authority" TEXT NOT NULL,
    "reference" TEXT,
    "submittedAt" TIMESTAMP(3),
    "decidedAt" TIMESTAMP(3),
    "note" TEXT,
    "applicationId" TEXT,
    "withdrawalId" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GovRegistration_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GovRegistration_orgId_kind_status_idx" ON "GovRegistration"("orgId", "kind", "status");

-- CreateIndex
CREATE INDEX "GovRegistration_orgId_studentId_idx" ON "GovRegistration"("orgId", "studentId");
