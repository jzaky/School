-- CreateEnum
CREATE TYPE "OfferingKind" AS ENUM ('CORE', 'OPTION');

-- CreateEnum
CREATE TYPE "RegistrationStatus" AS ENUM ('REQUESTED', 'ALLOCATED', 'WAITLISTED', 'DROPPED');

-- CreateEnum
CREATE TYPE "RegistrationSource" AS ENUM ('STUDENT', 'PARENT', 'STAFF', 'IMPORT', 'SUBJECT_CHANGE');

-- CreateEnum
CREATE TYPE "AssessmentKind" AS ENUM ('HOMEWORK', 'QUIZ', 'TEST', 'EXAM', 'PROJECT', 'COURSEWORK', 'PARTICIPATION');

-- CreateEnum
CREATE TYPE "TripStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'CANCELLED', 'COMPLETED');

-- CreateEnum
CREATE TYPE "TripConsent" AS ENUM ('PENDING', 'GRANTED', 'DECLINED');

-- CreateEnum
CREATE TYPE "SchoolCurriculum" AS ENUM ('BRITISH', 'IB', 'AMERICAN', 'UAE_MOE', 'OTHER');

-- CreateEnum
CREATE TYPE "LessonPlanStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'CHANGES_REQUESTED', 'APPROVED');

-- AlterTable
ALTER TABLE "CalendarEvent" ADD COLUMN     "gradeLevels" INTEGER[],
ADD COLUMN     "locationAr" TEXT,
ADD COLUMN     "locationEn" TEXT,
ADD COLUMN     "published" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "SchoolClass" ADD COLUMN     "capacity" INTEGER,
ADD COLUMN     "optionBlock" TEXT;

-- AlterTable
ALTER TABLE "Student" ADD COLUMN     "curriculum" "SchoolCurriculum" NOT NULL DEFAULT 'BRITISH';

-- AlterTable
ALTER TABLE "University" ADD COLUMN     "applyVia" TEXT,
ADD COLUMN     "scorecardId" TEXT,
ADD COLUMN     "system" TEXT;

-- CreateTable
CREATE TABLE "SubjectOffering" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "academicYearId" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "gradeLevel" INTEGER NOT NULL,
    "kind" "OfferingKind" NOT NULL DEFAULT 'CORE',
    "optionBlock" TEXT,
    "prerequisites" TEXT[],
    "notesEn" TEXT,
    "notesAr" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SubjectOffering_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubjectRegistration" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "academicYearId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "status" "RegistrationStatus" NOT NULL DEFAULT 'REQUESTED',
    "source" "RegistrationSource" NOT NULL DEFAULT 'STAFF',
    "classId" TEXT,
    "preference" INTEGER NOT NULL DEFAULT 1,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SubjectRegistration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Assessment" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "classId" TEXT NOT NULL,
    "termId" TEXT,
    "titleEn" TEXT NOT NULL,
    "titleAr" TEXT NOT NULL,
    "kind" "AssessmentKind" NOT NULL DEFAULT 'TEST',
    "maxScore" DOUBLE PRECISION NOT NULL DEFAULT 100,
    "weight" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "dueAt" TIMESTAMP(3),
    "publishedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Assessment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Grade" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "assessmentId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "score" DOUBLE PRECISION,
    "excused" BOOLEAN NOT NULL DEFAULT false,
    "commentEn" TEXT,
    "commentAr" TEXT,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Grade_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GradeBand" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "minPercent" DOUBLE PRECISION NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "GradeBand_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Trip" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "titleEn" TEXT NOT NULL,
    "titleAr" TEXT NOT NULL,
    "descEn" TEXT,
    "descAr" TEXT,
    "destinationEn" TEXT NOT NULL,
    "destinationAr" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "costAed" INTEGER,
    "consentDeadline" TIMESTAMP(3),
    "status" "TripStatus" NOT NULL DEFAULT 'DRAFT',
    "gradeLevels" INTEGER[],
    "classIds" TEXT[],
    "organizerId" TEXT NOT NULL,
    "templateKey" TEXT,
    "calendarEventId" TEXT,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Trip_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TripParticipant" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "tripId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "consent" "TripConsent" NOT NULL DEFAULT 'PENDING',
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "noteEn" TEXT,
    "documentId" TEXT,
    "letterSentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TripParticipant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UniversityProgram" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "universityId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL,
    "nameAr" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "degree" TEXT NOT NULL,
    "durationYears" DOUBLE PRECISION NOT NULL DEFAULT 3,
    "requiredSubjects" TEXT[],
    "recommendedSubjects" TEXT[],
    "requirements" JSONB NOT NULL,
    "englishReq" JSONB,
    "notesEn" TEXT,
    "notesAr" TEXT,
    "sourceUrl" TEXT,
    "lastVerifiedAt" TIMESTAMP(3),
    "indicative" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UniversityProgram_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StudentSubjectResult" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "subjectCode" TEXT NOT NULL,
    "curriculum" "SchoolCurriculum" NOT NULL DEFAULT 'BRITISH',
    "level" TEXT,
    "predicted" TEXT,
    "achieved" TEXT,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StudentSubjectResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StudentTestScore" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "takenAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StudentTestScore_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CurriculumFramework" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL,
    "nameAr" TEXT NOT NULL,
    "sourceEn" TEXT,
    "subjectId" TEXT,
    "gradeLevel" INTEGER,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CurriculumFramework_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CurriculumStandard" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "frameworkId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "strandEn" TEXT NOT NULL,
    "strandAr" TEXT NOT NULL,
    "descEn" TEXT NOT NULL,
    "descAr" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "CurriculumStandard_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LessonPlan" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "gradeLevel" INTEGER NOT NULL,
    "classId" TEXT,
    "termId" TEXT,
    "weekNo" INTEGER,
    "plannedFor" TIMESTAMP(3),
    "titleEn" TEXT NOT NULL,
    "titleAr" TEXT NOT NULL,
    "objectivesEn" TEXT,
    "objectivesAr" TEXT,
    "activities" JSONB,
    "materials" JSONB,
    "assessmentEn" TEXT,
    "assessmentAr" TEXT,
    "differentiation" TEXT,
    "durationMin" INTEGER NOT NULL DEFAULT 50,
    "status" "LessonPlanStatus" NOT NULL DEFAULT 'DRAFT',
    "authorId" TEXT NOT NULL,
    "reviewerId" TEXT,
    "reviewComment" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "aiDrafted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LessonPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LessonPlanStandard" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "lessonPlanId" TEXT NOT NULL,
    "standardId" TEXT NOT NULL,

    CONSTRAINT "LessonPlanStandard_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SubjectOffering_orgId_idx" ON "SubjectOffering"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "SubjectOffering_orgId_academicYearId_subjectId_gradeLevel_key" ON "SubjectOffering"("orgId", "academicYearId", "subjectId", "gradeLevel");

-- CreateIndex
CREATE INDEX "SubjectRegistration_orgId_studentId_idx" ON "SubjectRegistration"("orgId", "studentId");

-- CreateIndex
CREATE UNIQUE INDEX "SubjectRegistration_academicYearId_studentId_subjectId_key" ON "SubjectRegistration"("academicYearId", "studentId", "subjectId");

-- CreateIndex
CREATE INDEX "Assessment_orgId_classId_idx" ON "Assessment"("orgId", "classId");

-- CreateIndex
CREATE INDEX "Grade_orgId_studentId_idx" ON "Grade"("orgId", "studentId");

-- CreateIndex
CREATE UNIQUE INDEX "Grade_assessmentId_studentId_key" ON "Grade"("assessmentId", "studentId");

-- CreateIndex
CREATE UNIQUE INDEX "GradeBand_orgId_label_key" ON "GradeBand"("orgId", "label");

-- CreateIndex
CREATE INDEX "Trip_orgId_startsAt_idx" ON "Trip"("orgId", "startsAt");

-- CreateIndex
CREATE INDEX "TripParticipant_orgId_studentId_idx" ON "TripParticipant"("orgId", "studentId");

-- CreateIndex
CREATE UNIQUE INDEX "TripParticipant_tripId_studentId_key" ON "TripParticipant"("tripId", "studentId");

-- CreateIndex
CREATE INDEX "UniversityProgram_orgId_universityId_idx" ON "UniversityProgram"("orgId", "universityId");

-- CreateIndex
CREATE UNIQUE INDEX "UniversityProgram_orgId_key_key" ON "UniversityProgram"("orgId", "key");

-- CreateIndex
CREATE INDEX "StudentSubjectResult_orgId_studentId_idx" ON "StudentSubjectResult"("orgId", "studentId");

-- CreateIndex
CREATE UNIQUE INDEX "StudentSubjectResult_studentId_subjectCode_level_key" ON "StudentSubjectResult"("studentId", "subjectCode", "level");

-- CreateIndex
CREATE INDEX "StudentTestScore_orgId_studentId_idx" ON "StudentTestScore"("orgId", "studentId");

-- CreateIndex
CREATE UNIQUE INDEX "CurriculumFramework_orgId_key_key" ON "CurriculumFramework"("orgId", "key");

-- CreateIndex
CREATE INDEX "CurriculumStandard_orgId_idx" ON "CurriculumStandard"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "CurriculumStandard_frameworkId_code_key" ON "CurriculumStandard"("frameworkId", "code");

-- CreateIndex
CREATE INDEX "LessonPlan_orgId_subjectId_gradeLevel_idx" ON "LessonPlan"("orgId", "subjectId", "gradeLevel");

-- CreateIndex
CREATE INDEX "LessonPlanStandard_orgId_idx" ON "LessonPlanStandard"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "LessonPlanStandard_lessonPlanId_standardId_key" ON "LessonPlanStandard"("lessonPlanId", "standardId");

-- AddForeignKey
ALTER TABLE "Grade" ADD CONSTRAINT "Grade_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "Assessment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TripParticipant" ADD CONSTRAINT "TripParticipant_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CurriculumStandard" ADD CONSTRAINT "CurriculumStandard_frameworkId_fkey" FOREIGN KEY ("frameworkId") REFERENCES "CurriculumFramework"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LessonPlanStandard" ADD CONSTRAINT "LessonPlanStandard_lessonPlanId_fkey" FOREIGN KEY ("lessonPlanId") REFERENCES "LessonPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LessonPlanStandard" ADD CONSTRAINT "LessonPlanStandard_standardId_fkey" FOREIGN KEY ("standardId") REFERENCES "CurriculumStandard"("id") ON DELETE CASCADE ON UPDATE CASCADE;
