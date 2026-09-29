-- CreateEnum
CREATE TYPE "InviteKind" AS ENUM ('STAFF', 'PARENT', 'STUDENT');

-- CreateEnum
CREATE TYPE "JoinRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- AlterEnum
ALTER TYPE "MembershipStatus" ADD VALUE 'PENDING_APPROVAL';

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "createdById" TEXT,
ADD COLUMN     "curricula" "SchoolCurriculum"[],
ADD COLUMN     "enabledModules" TEXT[],
ADD COLUMN     "googleSignIn" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "joinCode" TEXT,
ADD COLUMN     "microsoftSignIn" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "onboardingCompletedAt" TIMESTAMP(3),
ADD COLUMN     "onboardingSteps" TEXT[],
ADD COLUMN     "parentJoinApproval" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "parentSelfJoin" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "staffDomainAutoApprove" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "staffEmailDomains" TEXT[],
ADD COLUMN     "studentSelfJoin" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "supportEmail" TEXT;

-- AlterTable
ALTER TABLE "Role" ADD COLUMN     "customized" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateTable
CREATE TABLE "Invitation" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "kind" "InviteKind" NOT NULL,
    "email" TEXT,
    "nameEn" TEXT,
    "roleKeys" TEXT[],
    "studentIds" TEXT[],
    "tokenHash" TEXT NOT NULL,
    "maxUses" INTEGER NOT NULL DEFAULT 1,
    "uses" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "lastSentAt" TIMESTAMP(3),
    "acceptedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Invitation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JoinRequest" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "kind" "InviteKind" NOT NULL,
    "claimedStudents" JSONB,
    "note" TEXT,
    "status" "JoinRequestStatus" NOT NULL DEFAULT 'PENDING',
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JoinRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Invitation_tokenHash_key" ON "Invitation"("tokenHash");

-- CreateIndex
CREATE INDEX "Invitation_orgId_kind_idx" ON "Invitation"("orgId", "kind");

-- CreateIndex
CREATE INDEX "Invitation_orgId_email_idx" ON "Invitation"("orgId", "email");

-- CreateIndex
CREATE INDEX "JoinRequest_orgId_status_idx" ON "JoinRequest"("orgId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Organization_joinCode_key" ON "Organization"("joinCode");

