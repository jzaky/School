-- Request conversations (shared, staff-only and private messages), read markers for unread indicators,
-- family-reported absences on attendance records, and private reasons for staff absence.

-- CreateEnum
CREATE TYPE "MessageVisibility" AS ENUM ('SHARED', 'STAFF', 'PRIVATE');

-- CreateEnum
CREATE TYPE "AttendanceSource" AS ENUM ('REGISTER', 'PARENT', 'STUDENT', 'OFFICE');

-- CreateEnum
CREATE TYPE "StaffAbsenceReason" AS ENUM ('SICK', 'MEDICAL_APPOINTMENT', 'ANNUAL_LEAVE', 'FAMILY', 'PARENTAL_LEAVE', 'RELIGIOUS', 'TRAINING', 'SCHOOL_BUSINESS', 'PERSONAL', 'OTHER');

-- CreateTable
CREATE TABLE "RequestMessage" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "visibility" "MessageVisibility" NOT NULL DEFAULT 'SHARED',
    "privateToIds" TEXT[],
    "body" TEXT NOT NULL,
    "familyNotified" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RequestMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RequestThreadRead" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "lastReadAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RequestThreadRead_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RequestMessage_orgId_requestId_createdAt_idx" ON "RequestMessage"("orgId", "requestId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "RequestThreadRead_requestId_membershipId_key" ON "RequestThreadRead"("requestId", "membershipId");

-- CreateIndex
CREATE INDEX "RequestThreadRead_orgId_membershipId_idx" ON "RequestThreadRead"("orgId", "membershipId");

-- AddForeignKey
ALTER TABLE "RequestMessage" ADD CONSTRAINT "RequestMessage_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "Request"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable: attendance marks remember where an excused absence came from.
ALTER TABLE "AttendanceRecord" ADD COLUMN "source" "AttendanceSource" NOT NULL DEFAULT 'REGISTER',
ADD COLUMN "requestId" TEXT;

-- AlterTable: the single notes field on a staff absence was always shown to substitutes as "Notes for
-- cover teachers", so existing values become cover notes. The private reason is new and starts empty.
ALTER TABLE "StaffAbsence" RENAME COLUMN "reasonEn" TO "coverNotes";
ALTER TABLE "StaffAbsence" ADD COLUMN "reasonKind" "StaffAbsenceReason",
ADD COLUMN "privateReason" TEXT,
ADD COLUMN "requestId" TEXT;
