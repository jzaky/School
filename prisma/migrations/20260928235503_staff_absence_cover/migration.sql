-- CreateEnum
CREATE TYPE "AbsenceStatus" AS ENUM ('REPORTED', 'COVERED', 'PARTLY_COVERED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "CoverStatus" AS ENUM ('ASSIGNED', 'UNCOVERED', 'DECLINED', 'DONE');

-- CreateTable
CREATE TABLE "StaffAbsence" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "startsOn" DATE NOT NULL,
    "endsOn" DATE NOT NULL,
    "allDay" BOOLEAN NOT NULL DEFAULT true,
    "fromPeriod" INTEGER,
    "toPeriod" INTEGER,
    "reasonEn" TEXT,
    "status" "AbsenceStatus" NOT NULL DEFAULT 'REPORTED',
    "reportedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StaffAbsence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CoverAssignment" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "absenceId" TEXT NOT NULL,
    "slotId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "periodNo" INTEGER NOT NULL,
    "classId" TEXT NOT NULL,
    "originalTeacherId" TEXT NOT NULL,
    "substituteId" TEXT,
    "status" "CoverStatus" NOT NULL DEFAULT 'ASSIGNED',
    "reasonEn" TEXT,
    "notifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CoverAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StaffAbsence_orgId_startsOn_idx" ON "StaffAbsence"("orgId", "startsOn");

-- CreateIndex
CREATE INDEX "CoverAssignment_orgId_date_idx" ON "CoverAssignment"("orgId", "date");

-- CreateIndex
CREATE INDEX "CoverAssignment_substituteId_date_idx" ON "CoverAssignment"("substituteId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "CoverAssignment_absenceId_slotId_date_key" ON "CoverAssignment"("absenceId", "slotId", "date");

-- AddForeignKey
ALTER TABLE "CoverAssignment" ADD CONSTRAINT "CoverAssignment_absenceId_fkey" FOREIGN KEY ("absenceId") REFERENCES "StaffAbsence"("id") ON DELETE CASCADE ON UPDATE CASCADE;
