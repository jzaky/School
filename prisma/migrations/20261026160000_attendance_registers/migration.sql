-- Attendance: school codes, settings (with an optional regulator absence limit), daily and lesson registers, lesson
-- marks, unexplained absence follow-up and staff alerts. Grades: who publishes (teachers, or a publisher) and the
-- ready state of assessments. RLS: every new table has orgId and gets the tenant policy from prisma/rls.sql.

-- CreateEnum
CREATE TYPE "AttendanceCountsAs" AS ENUM ('PRESENT', 'ABSENT', 'NOT_COUNTED');

-- CreateEnum
CREATE TYPE "RegisterMode" AS ENUM ('HORIZON', 'EXTERNAL');

-- CreateEnum
CREATE TYPE "RegisterKind" AS ENUM ('DAILY', 'LESSON');

-- CreateEnum
CREATE TYPE "FollowUpStatus" AS ENUM ('OPEN', 'CONTACTED', 'EXPLAINED');

-- CreateEnum
CREATE TYPE "GradePublishMode" AS ENUM ('TEACHER', 'PUBLISHER');

-- AlterTable
ALTER TABLE "Assessment" ADD COLUMN     "publishedById" TEXT,
ADD COLUMN     "readyAt" TIMESTAMP(3),
ADD COLUMN     "readyById" TEXT;

-- AlterTable
ALTER TABLE "AttendanceRecord" ADD COLUMN     "code" TEXT,
ADD COLUMN     "markedById" TEXT,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateTable
CREATE TABLE "AttendanceCode" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "labelEn" TEXT NOT NULL,
    "labelAr" TEXT NOT NULL,
    "countsAs" "AttendanceCountsAs" NOT NULL,
    "authorised" BOOLEAN NOT NULL DEFAULT false,
    "late" BOOLEAN NOT NULL DEFAULT false,
    "category" TEXT NOT NULL,
    "private" BOOLEAN NOT NULL DEFAULT false,
    "quick" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AttendanceCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AttendanceSettings" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "mode" "RegisterMode" NOT NULL DEFAULT 'HORIZON',
    "dailyStart" TEXT NOT NULL DEFAULT '07:30',
    "lateCutoffMin" INTEGER NOT NULL DEFAULT 30,
    "closeTime" TEXT NOT NULL DEFAULT '15:30',
    "followUpTime" TEXT NOT NULL DEFAULT '09:30',
    "autoNotify" BOOLEAN NOT NULL DEFAULT true,
    "persistentThreshold" DOUBLE PRECISION NOT NULL DEFAULT 90,
    "persistentMinDays" INTEGER NOT NULL DEFAULT 10,
    "dailyOnlyGrades" INTEGER[] DEFAULT ARRAY[-1, 0]::INTEGER[],
    "limitEnabled" BOOLEAN NOT NULL DEFAULT false,
    "limitConsecutive" INTEGER NOT NULL DEFAULT 10,
    "limitTotal" INTEGER NOT NULL DEFAULT 15,
    "limitWarnPct" INTEGER NOT NULL DEFAULT 70,
    "headsOfYear" JSONB NOT NULL DEFAULT '{}',
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AttendanceSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AttendanceRegister" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "kind" "RegisterKind" NOT NULL,
    "classId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "periodNo" INTEGER NOT NULL DEFAULT 0,
    "slotId" TEXT,
    "coverId" TEXT,
    "takenById" TEXT,
    "takenAt" TIMESTAMP(3),
    "closedById" TEXT,
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AttendanceRegister_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AttendanceLessonMark" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "registerId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "code" TEXT NOT NULL,
    "status" "AttendanceStatus" NOT NULL,
    "minutesLate" INTEGER,
    "source" "AttendanceSource" NOT NULL DEFAULT 'REGISTER',
    "requestId" TEXT,
    "markedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AttendanceLessonMark_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AttendanceFollowUp" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "status" "FollowUpStatus" NOT NULL DEFAULT 'OPEN',
    "notifiedAt" TIMESTAMP(3),
    "heldReason" TEXT,
    "explainedCode" TEXT,
    "explainedById" TEXT,
    "explainedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AttendanceFollowUp_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AttendanceContact" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "followUpId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "outcome" TEXT,
    "note" TEXT,
    "reason" TEXT,
    "byId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AttendanceContact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AttendanceAlert" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'PERSISTENT',
    "periodId" TEXT NOT NULL,
    "percent" DOUBLE PRECISION,
    "threshold" DOUBLE PRECISION,
    "possible" INTEGER,
    "consecutive" INTEGER,
    "total" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "AttendanceAlert_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GradeSettings" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "publishMode" "GradePublishMode" NOT NULL DEFAULT 'TEACHER',
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GradeSettings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AttendanceCode_orgId_code_key" ON "AttendanceCode"("orgId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "AttendanceSettings_orgId_key" ON "AttendanceSettings"("orgId");

-- CreateIndex
CREATE INDEX "AttendanceRegister_orgId_date_idx" ON "AttendanceRegister"("orgId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "AttendanceRegister_classId_date_periodNo_key" ON "AttendanceRegister"("classId", "date", "periodNo");

-- CreateIndex
CREATE INDEX "AttendanceLessonMark_orgId_date_idx" ON "AttendanceLessonMark"("orgId", "date");

-- CreateIndex
CREATE INDEX "AttendanceLessonMark_orgId_studentId_date_idx" ON "AttendanceLessonMark"("orgId", "studentId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "AttendanceLessonMark_registerId_studentId_key" ON "AttendanceLessonMark"("registerId", "studentId");

-- CreateIndex
CREATE INDEX "AttendanceFollowUp_orgId_date_status_idx" ON "AttendanceFollowUp"("orgId", "date", "status");

-- CreateIndex
CREATE UNIQUE INDEX "AttendanceFollowUp_studentId_date_key" ON "AttendanceFollowUp"("studentId", "date");

-- CreateIndex
CREATE INDEX "AttendanceContact_orgId_followUpId_idx" ON "AttendanceContact"("orgId", "followUpId");

-- CreateIndex
CREATE INDEX "AttendanceAlert_orgId_periodId_idx" ON "AttendanceAlert"("orgId", "periodId");

-- CreateIndex
CREATE UNIQUE INDEX "AttendanceAlert_studentId_periodId_kind_key" ON "AttendanceAlert"("studentId", "periodId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "GradeSettings_orgId_key" ON "GradeSettings"("orgId");

-- CreateIndex
CREATE INDEX "Assessment_orgId_readyAt_idx" ON "Assessment"("orgId", "readyAt");

-- AddForeignKey
ALTER TABLE "AttendanceLessonMark" ADD CONSTRAINT "AttendanceLessonMark_registerId_fkey" FOREIGN KEY ("registerId") REFERENCES "AttendanceRegister"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceContact" ADD CONSTRAINT "AttendanceContact_followUpId_fkey" FOREIGN KEY ("followUpId") REFERENCES "AttendanceFollowUp"("id") ON DELETE CASCADE ON UPDATE CASCADE;

