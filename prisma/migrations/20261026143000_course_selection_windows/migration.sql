-- Course selection: windows with opening and closing times per year and grade (replacing the deadline-only
-- calendar marker), late-change exceptions, class choosing sessions, assisted choosing and sign-off.

-- CreateEnum
CREATE TYPE "ParentChoiceMode" AS ENUM ('ALWAYS', 'WHEN_ALLOWED', 'NEVER');

-- CreateEnum
CREATE TYPE "SelectionHelperKind" AS ENUM ('STAFF', 'GUARDIAN');

-- CreateEnum
CREATE TYPE "CourseSelectionStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'SIGNED_OFF');

-- AlterTable
ALTER TABLE "SubjectRegistration" ADD COLUMN     "chosenAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "CourseSelectionSettings" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "parentChoice" "ParentChoiceMode" NOT NULL DEFAULT 'ALWAYS',
    "signOffRequired" BOOLEAN NOT NULL DEFAULT false,
    "parentChoiceSignsOff" BOOLEAN NOT NULL DEFAULT true,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CourseSelectionSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CourseSelectionWindow" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "academicYearId" TEXT NOT NULL,
    "gradeLevels" INTEGER[],
    "opensAt" TIMESTAMP(3) NOT NULL,
    "closesAt" TIMESTAMP(3) NOT NULL,
    "roundEn" TEXT,
    "roundAr" TEXT,
    "calendarEventId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CourseSelectionWindow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CourseSelectionException" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "academicYearId" TEXT NOT NULL,
    "until" TIMESTAMP(3) NOT NULL,
    "reason" TEXT NOT NULL,
    "grantedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    "revokedById" TEXT,

    CONSTRAINT "CourseSelectionException_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CourseSelectionSession" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "classId" TEXT NOT NULL,
    "academicYearId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "startedById" TEXT NOT NULL,
    "endedAt" TIMESTAMP(3),
    "endedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CourseSelectionSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CourseSelectionHelper" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "helperId" TEXT NOT NULL,
    "kind" "SelectionHelperKind" NOT NULL,
    "until" TIMESTAMP(3) NOT NULL,
    "reason" TEXT,
    "grantedById" TEXT NOT NULL,
    "byStudent" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    "revokedById" TEXT,

    CONSTRAINT "CourseSelectionHelper_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CourseSelectionSubmission" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "academicYearId" TEXT NOT NULL,
    "status" "CourseSelectionStatus" NOT NULL DEFAULT 'DRAFT',
    "lastById" TEXT,
    "lastSource" "RegistrationSource",
    "onBehalf" BOOLEAN NOT NULL DEFAULT false,
    "afterClose" BOOLEAN NOT NULL DEFAULT false,
    "lastAt" TIMESTAMP(3),
    "submittedAt" TIMESTAMP(3),
    "signedOffAt" TIMESTAMP(3),
    "signedOffById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CourseSelectionSubmission_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CourseSelectionSettings_orgId_key" ON "CourseSelectionSettings"("orgId");

-- CreateIndex
CREATE INDEX "CourseSelectionWindow_orgId_academicYearId_idx" ON "CourseSelectionWindow"("orgId", "academicYearId");

-- CreateIndex
CREATE INDEX "CourseSelectionException_orgId_studentId_idx" ON "CourseSelectionException"("orgId", "studentId");

-- CreateIndex
CREATE INDEX "CourseSelectionSession_orgId_classId_idx" ON "CourseSelectionSession"("orgId", "classId");

-- CreateIndex
CREATE UNIQUE INDEX "CourseSelectionSession_orgId_code_key" ON "CourseSelectionSession"("orgId", "code");

-- CreateIndex
CREATE INDEX "CourseSelectionHelper_orgId_studentId_idx" ON "CourseSelectionHelper"("orgId", "studentId");

-- CreateIndex
CREATE INDEX "CourseSelectionHelper_orgId_helperId_idx" ON "CourseSelectionHelper"("orgId", "helperId");

-- CreateIndex
CREATE INDEX "CourseSelectionSubmission_orgId_academicYearId_idx" ON "CourseSelectionSubmission"("orgId", "academicYearId");

-- CreateIndex
CREATE UNIQUE INDEX "CourseSelectionSubmission_academicYearId_studentId_key" ON "CourseSelectionSubmission"("academicYearId", "studentId");


-- Data: every existing deadline-only window (a DEADLINE calendar event carrying the "registration_window"
-- marker) becomes a window. It was open from when it was set until the deadline, so it opens at the event's
-- creation time and closes at the deadline. A "year:<id>" tag names next year's course selection; otherwise
-- it is the school's current year. The grades are the students who choose: the grades with offerings that
-- year (one grade below for next year), or every grade with students when there are no offerings.
INSERT INTO "CourseSelectionWindow" ("id", "orgId", "academicYearId", "gradeLevels", "opensAt", "closesAt", "calendarEventId", "createdById", "createdAt", "updatedAt")
SELECT
  'csw' || substr(md5(e."id"), 1, 22),
  e."orgId",
  y."id",
  COALESCE(
    (SELECT array_agg(DISTINCT so."gradeLevel" - CASE WHEN t.tag IS NULL THEN 0 ELSE 1 END)
       FROM "SubjectOffering" so WHERE so."academicYearId" = y."id"),
    (SELECT array_agg(DISTINCT s."gradeLevel") FROM "Student" s WHERE s."orgId" = e."orgId"),
    '{}'
  ),
  LEAST(e."createdAt", e."startsAt"),
  e."startsAt",
  e."id",
  e."ownerId",
  e."createdAt",
  CURRENT_TIMESTAMP
FROM "CalendarEvent" e
LEFT JOIN LATERAL (
  SELECT substr(a, 6) AS tag FROM unnest(e."audience") AS a WHERE a LIKE 'year:%' LIMIT 1
) t ON true
JOIN LATERAL (
  SELECT ay."id" FROM "AcademicYear" ay
  WHERE ay."orgId" = e."orgId" AND (CASE WHEN t.tag IS NULL THEN ay."isCurrent" ELSE ay."id" = t.tag END)
  ORDER BY ay."startsOn" DESC LIMIT 1
) y ON true
WHERE e."kind" = 'DEADLINE' AND 'registration_window' = ANY(e."audience")
ON CONFLICT ("id") DO NOTHING;

-- The calendar event now belongs to its window: it carries the window's grades.
UPDATE "CalendarEvent" e SET "gradeLevels" = w."gradeLevels"
FROM "CourseSelectionWindow" w
WHERE w."calendarEventId" = e."id" AND cardinality(e."gradeLevels") = 0;
