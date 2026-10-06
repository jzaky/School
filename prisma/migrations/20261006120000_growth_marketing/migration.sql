-- CreateEnum
CREATE TYPE "MarketingLeadType" AS ENUM ('TASTER', 'OFFER');

-- CreateEnum
CREATE TYPE "MarketingLeadRole" AS ENUM ('STUDENT', 'PARENT', 'STAFF');

-- CreateEnum
CREATE TYPE "LeadEmailStatus" AS ENUM ('QUEUED', 'SENT', 'FAILED', 'SKIPPED');

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "referralCode" TEXT,
ADD COLUMN     "referredByOrgId" TEXT;

-- CreateTable
CREATE TABLE "MarketingLead" (
    "id" TEXT NOT NULL,
    "type" "MarketingLeadType" NOT NULL,
    "source" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" "MarketingLeadRole" NOT NULL,
    "schoolName" TEXT,
    "locale" "Locale" NOT NULL DEFAULT 'en',
    "consentAt" TIMESTAMP(3) NOT NULL,
    "consentVersion" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "emailStatus" "LeadEmailStatus" NOT NULL DEFAULT 'QUEUED',
    "emailSentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MarketingLead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlatformSetting" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlatformSetting_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "UptimeSample" (
    "slot" TIMESTAMP(3) NOT NULL,
    "web" BOOLEAN,
    "database" BOOLEAN NOT NULL,
    "redis" BOOLEAN NOT NULL,
    "worker" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UptimeSample_pkey" PRIMARY KEY ("slot")
);

-- CreateIndex
CREATE INDEX "MarketingLead_type_createdAt_idx" ON "MarketingLead"("type", "createdAt");

-- CreateIndex
CREATE INDEX "MarketingLead_createdAt_idx" ON "MarketingLead"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Organization_referralCode_key" ON "Organization"("referralCode");

-- CreateIndex
CREATE INDEX "Organization_referredByOrgId_idx" ON "Organization"("referredByOrgId");

