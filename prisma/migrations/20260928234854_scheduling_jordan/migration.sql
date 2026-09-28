-- CreateEnum
CREATE TYPE "PeriodKind" AS ENUM ('LESSON', 'BREAK', 'ASSEMBLY');

-- CreateEnum
CREATE TYPE "ExamStatus" AS ENUM ('DRAFT', 'PUBLISHED');

-- AlterEnum
ALTER TYPE "SchoolCurriculum" ADD VALUE 'JORDAN_TAWJIHI';

-- AlterTable
ALTER TABLE "SubjectOffering" ADD COLUMN     "periodsPerWeek" INTEGER NOT NULL DEFAULT 4;

-- CreateTable
CREATE TABLE "TeacherSubject" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "gradeLevels" INTEGER[],
    "maxPeriodsPerWeek" INTEGER NOT NULL DEFAULT 24,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TeacherSubject_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BellPeriod" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "academicYearId" TEXT NOT NULL,
    "dayOfWeek" INTEGER NOT NULL,
    "periodNo" INTEGER NOT NULL,
    "startTime" TEXT NOT NULL,
    "endTime" TEXT NOT NULL,
    "kind" "PeriodKind" NOT NULL DEFAULT 'LESSON',

    CONSTRAINT "BellPeriod_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TimetableSlot" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "academicYearId" TEXT NOT NULL,
    "classId" TEXT NOT NULL,
    "teacherMembershipId" TEXT,
    "dayOfWeek" INTEGER NOT NULL,
    "periodNo" INTEGER NOT NULL,
    "room" TEXT,
    "locked" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TimetableSlot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExamSitting" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "termId" TEXT,
    "subjectId" TEXT NOT NULL,
    "gradeLevel" INTEGER NOT NULL,
    "titleEn" TEXT NOT NULL,
    "titleAr" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "room" TEXT,
    "invigilatorIds" TEXT[],
    "status" "ExamStatus" NOT NULL DEFAULT 'DRAFT',
    "calendarEventId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExamSitting_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TeacherSubject_orgId_idx" ON "TeacherSubject"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "TeacherSubject_membershipId_subjectId_key" ON "TeacherSubject"("membershipId", "subjectId");

-- CreateIndex
CREATE INDEX "BellPeriod_orgId_idx" ON "BellPeriod"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "BellPeriod_academicYearId_dayOfWeek_periodNo_key" ON "BellPeriod"("academicYearId", "dayOfWeek", "periodNo");

-- CreateIndex
CREATE INDEX "TimetableSlot_orgId_academicYearId_idx" ON "TimetableSlot"("orgId", "academicYearId");

-- CreateIndex
CREATE INDEX "TimetableSlot_teacherMembershipId_dayOfWeek_periodNo_idx" ON "TimetableSlot"("teacherMembershipId", "dayOfWeek", "periodNo");

-- CreateIndex
CREATE UNIQUE INDEX "TimetableSlot_classId_dayOfWeek_periodNo_key" ON "TimetableSlot"("classId", "dayOfWeek", "periodNo");

-- CreateIndex
CREATE INDEX "ExamSitting_orgId_startsAt_idx" ON "ExamSitting"("orgId", "startsAt");
