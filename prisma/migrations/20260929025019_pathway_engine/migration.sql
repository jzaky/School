-- CreateEnum
CREATE TYPE "SubjectLevel" AS ENUM ('FOUNDATION', 'STANDARD', 'ADVANCED', 'HIGHER');

-- CreateEnum
CREATE TYPE "SubjectRequirementType" AS ENUM ('REQUIRED', 'RECOMMENDED', 'PREFERRED', 'OPTIONAL', 'ONE_OF', 'TWO_OF');

-- CreateEnum
CREATE TYPE "DataConfidence" AS ENUM ('VERIFIED', 'REVIEWED', 'EXTRACTED', 'EXAMPLE', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "MatchStatus" AS ENUM ('ELIGIBLE', 'ON_TRACK', 'POSSIBLY_ELIGIBLE', 'MISSING_REQUIREMENTS', 'NEEDS_MANUAL_REVIEW', 'UNKNOWN_DATA');

-- CreateEnum
CREATE TYPE "StudentCourseStatus" AS ENUM ('COMPLETED', 'IN_PROGRESS', 'PLANNED');

-- CreateEnum
CREATE TYPE "MappingStatus" AS ENUM ('AUTO', 'NEEDS_REVIEW', 'CONFIRMED');

-- CreateEnum
CREATE TYPE "CoursePlanStatus" AS ENUM ('DRAFT', 'PROPOSED', 'APPROVED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "SourceStatus" AS ENUM ('PENDING', 'FETCHED', 'UNCHANGED', 'CHANGED', 'FAILED');

-- CreateEnum
CREATE TYPE "ExtractionStatus" AS ENUM ('PENDING_REVIEW', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ChangeStatus" AS ENUM ('NEEDS_REVIEW', 'ACKNOWLEDGED');

-- CreateEnum
CREATE TYPE "ApplicationStage" AS ENUM ('RESEARCHING', 'SHORTLISTED', 'PREPARING', 'SUBMITTED', 'INTERVIEW', 'OFFER', 'REJECTED', 'WAITLISTED', 'ACCEPTED', 'ENROLLED');

-- CreateEnum
CREATE TYPE "ApplicationItemStatus" AS ENUM ('TODO', 'IN_PROGRESS', 'DONE', 'WAIVED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "SchoolCurriculum" ADD VALUE 'CBSE';
ALTER TYPE "SchoolCurriculum" ADD VALUE 'ISC';
ALTER TYPE "SchoolCurriculum" ADD VALUE 'SABIS';

-- AlterTable
ALTER TABLE "ShortlistEntry" ADD COLUMN     "programId" TEXT;

-- AlterTable
ALTER TABLE "University" ADD COLUMN     "flagCode" TEXT,
ADD COLUMN     "nameSearch" TEXT,
ADD COLUMN     "stats" JSONB,
ALTER COLUMN "orgId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "UniversityProgram" ADD COLUMN     "campusId" TEXT,
ADD COLUMN     "degreeType" TEXT,
ADD COLUMN     "fieldKeys" TEXT[],
ADD COLUMN     "level" TEXT NOT NULL DEFAULT 'UNDERGRADUATE',
ADD COLUMN     "searchText" TEXT,
ADD COLUMN     "teachingLanguage" TEXT,
ADD COLUMN     "tuitionCurrency" TEXT,
ADD COLUMN     "tuitionPerYear" INTEGER,
ALTER COLUMN "orgId" DROP NOT NULL;

-- CreateTable
CREATE TABLE "CanonicalSubject" (
    "key" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL,
    "nameAr" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "parentKey" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "CanonicalSubject_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "FieldOfStudy" (
    "key" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL,
    "nameAr" TEXT NOT NULL,
    "cipCodes" TEXT[],
    "related" TEXT[],
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "FieldOfStudy_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "CareerField" (
    "id" TEXT NOT NULL,
    "careerKey" TEXT NOT NULL,
    "fieldKey" TEXT NOT NULL,
    "weight" INTEGER NOT NULL DEFAULT 3,

    CONSTRAINT "CareerField_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UniversityCampus" (
    "id" TEXT NOT NULL,
    "orgId" TEXT,
    "universityId" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL,
    "nameAr" TEXT NOT NULL,
    "cityEn" TEXT NOT NULL,
    "cityAr" TEXT NOT NULL,
    "countryCode" TEXT NOT NULL,

    CONSTRAINT "UniversityCampus_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProgramIntake" (
    "id" TEXT NOT NULL,
    "orgId" TEXT,
    "programId" TEXT NOT NULL,
    "intakeYear" INTEGER NOT NULL,
    "cycleLabel" TEXT,
    "applicationOpens" TIMESTAMP(3),
    "isCurrent" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "ProgramIntake_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CurriculumCourse" (
    "id" TEXT NOT NULL,
    "orgId" TEXT,
    "curriculum" "SchoolCurriculum" NOT NULL,
    "code" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL,
    "nameAr" TEXT NOT NULL,
    "qualification" TEXT NOT NULL,
    "gradeLevel" INTEGER,
    "gradeScale" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CurriculumCourse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CurriculumCourseMapping" (
    "id" TEXT NOT NULL,
    "orgId" TEXT,
    "courseId" TEXT NOT NULL,
    "canonicalSubjectKey" TEXT NOT NULL,
    "level" "SubjectLevel" NOT NULL,
    "rigorScore" INTEGER NOT NULL DEFAULT 3,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),

    CONSTRAINT "CurriculumCourseMapping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SchoolCourse" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "subjectId" TEXT,
    "gradeLevels" INTEGER[],
    "active" BOOLEAN NOT NULL DEFAULT true,
    "notesEn" TEXT,
    "notesAr" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SchoolCourse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StudentCourse" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "courseId" TEXT,
    "localName" TEXT NOT NULL,
    "gradeLevel" INTEGER NOT NULL,
    "schoolYear" TEXT,
    "status" "StudentCourseStatus" NOT NULL,
    "finalGrade" TEXT,
    "predictedGrade" TEXT,
    "gradeScale" TEXT,
    "source" TEXT NOT NULL DEFAULT 'MANUAL',
    "mappingStatus" "MappingStatus" NOT NULL DEFAULT 'AUTO',
    "importId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StudentCourse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TranscriptImport" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "studentId" TEXT,
    "fileName" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" "ImportStatus" NOT NULL DEFAULT 'PENDING',
    "rows" JSONB,
    "errors" JSONB,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TranscriptImport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StudentCoursePlan" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "CoursePlanStatus" NOT NULL DEFAULT 'DRAFT',
    "goalCareerKey" TEXT,
    "goalFieldKeys" TEXT[],
    "targetCountries" TEXT[],
    "targetProgramIds" TEXT[],
    "proposedById" TEXT,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "counselorNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StudentCoursePlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StudentCoursePlanItem" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "gradeLevel" INTEGER NOT NULL,
    "schoolCourseId" TEXT,
    "courseId" TEXT,
    "reasonEn" TEXT,
    "reasonAr" TEXT,
    "locked" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "StudentCoursePlanItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RequirementSource" (
    "id" TEXT NOT NULL,
    "orgId" TEXT,
    "universityId" TEXT NOT NULL,
    "programId" TEXT,
    "url" TEXT NOT NULL,
    "title" TEXT,
    "sourceType" TEXT NOT NULL,
    "status" "SourceStatus" NOT NULL DEFAULT 'PENDING',
    "retrievedAt" TIMESTAMP(3),
    "contentHash" TEXT,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RequirementSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RequirementExtraction" (
    "id" TEXT NOT NULL,
    "orgId" TEXT,
    "sourceId" TEXT NOT NULL,
    "rawText" TEXT NOT NULL,
    "normalizedJson" JSONB NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "model" TEXT NOT NULL,
    "status" "ExtractionStatus" NOT NULL DEFAULT 'PENDING_REVIEW',
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RequirementExtraction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProgramRequirement" (
    "id" TEXT NOT NULL,
    "orgId" TEXT,
    "programId" TEXT NOT NULL,
    "intakeYear" INTEGER NOT NULL,
    "curriculum" "SchoolCurriculum",
    "version" INTEGER NOT NULL DEFAULT 1,
    "isCurrent" BOOLEAN NOT NULL DEFAULT true,
    "effectiveFrom" TIMESTAMP(3),
    "effectiveTo" TIMESTAMP(3),
    "confidence" "DataConfidence" NOT NULL DEFAULT 'UNKNOWN',
    "sourceId" TEXT,
    "extractionId" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "verifiedById" TEXT,
    "minimumGPA" DOUBLE PRECISION,
    "minimumPercent" DOUBLE PRECISION,
    "minimumPoints" INTEGER,
    "gradeProfile" TEXT,
    "stream" TEXT,
    "notesEn" TEXT,
    "notesAr" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProgramRequirement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubjectRequirement" (
    "id" TEXT NOT NULL,
    "orgId" TEXT,
    "programRequirementId" TEXT NOT NULL,
    "type" "SubjectRequirementType" NOT NULL,
    "canonicalSubjectKeys" TEXT[],
    "minimumLevel" "SubjectLevel",
    "minimumGrade" TEXT,
    "alternatives" TEXT[],
    "noteEn" TEXT,
    "noteAr" TEXT,

    CONSTRAINT "SubjectRequirement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LanguageRequirement" (
    "id" TEXT NOT NULL,
    "orgId" TEXT,
    "programRequirementId" TEXT NOT NULL,
    "test" TEXT NOT NULL,
    "minOverall" DOUBLE PRECISION NOT NULL,
    "minComponent" DOUBLE PRECISION,
    "waiverNoteEn" TEXT,

    CONSTRAINT "LanguageRequirement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TestRequirement" (
    "id" TEXT NOT NULL,
    "orgId" TEXT,
    "programRequirementId" TEXT NOT NULL,
    "test" TEXT NOT NULL,
    "policy" TEXT NOT NULL,
    "minScore" DOUBLE PRECISION,
    "noteEn" TEXT,

    CONSTRAINT "TestRequirement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdditionalRequirement" (
    "id" TEXT NOT NULL,
    "orgId" TEXT,
    "programRequirementId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT true,
    "noteEn" TEXT,
    "noteAr" TEXT,

    CONSTRAINT "AdditionalRequirement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RequirementChange" (
    "id" TEXT NOT NULL,
    "orgId" TEXT,
    "programId" TEXT NOT NULL,
    "fromVersionId" TEXT,
    "toVersionId" TEXT,
    "summaryEn" TEXT NOT NULL,
    "diff" JSONB NOT NULL,
    "status" "ChangeStatus" NOT NULL DEFAULT 'NEEDS_REVIEW',
    "reviewedById" TEXT,
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RequirementChange_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RequirementMatch" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "planId" TEXT,
    "status" "MatchStatus" NOT NULL,
    "requiredSatisfied" INTEGER NOT NULL DEFAULT 0,
    "requiredMissing" INTEGER NOT NULL DEFAULT 0,
    "recommendedSatisfied" INTEGER NOT NULL DEFAULT 0,
    "detail" JSONB NOT NULL,
    "inputsHash" TEXT NOT NULL,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RequirementMatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CourseImpactAnalysis" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "planId" TEXT,
    "courseId" TEXT NOT NULL,
    "unlocks" INTEGER NOT NULL DEFAULT 0,
    "improves" INTEGER NOT NULL DEFAULT 0,
    "requiredBy" INTEGER NOT NULL DEFAULT 0,
    "detail" JSONB NOT NULL,
    "inputsHash" TEXT NOT NULL,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CourseImpactAnalysis_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Application" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "programId" TEXT,
    "universityId" TEXT NOT NULL,
    "intakeYear" INTEGER NOT NULL,
    "stage" "ApplicationStage" NOT NULL DEFAULT 'RESEARCHING',
    "route" TEXT,
    "decisionPlan" TEXT,
    "counselorId" TEXT,
    "notes" TEXT,
    "submittedAt" TIMESTAMP(3),
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Application_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApplicationRequirement" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "titleEn" TEXT NOT NULL,
    "titleAr" TEXT NOT NULL,
    "status" "ApplicationItemStatus" NOT NULL DEFAULT 'TODO',
    "dueAt" TIMESTAMP(3),
    "taskId" TEXT,

    CONSTRAINT "ApplicationRequirement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApplicationDeadline" (
    "id" TEXT NOT NULL,
    "orgId" TEXT,
    "universityId" TEXT,
    "programId" TEXT,
    "intakeYear" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "sourceId" TEXT,
    "noteEn" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApplicationDeadline_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CareerField_careerKey_fieldKey_key" ON "CareerField"("careerKey", "fieldKey");

-- CreateIndex
CREATE INDEX "UniversityCampus_universityId_idx" ON "UniversityCampus"("universityId");

-- CreateIndex
CREATE UNIQUE INDEX "ProgramIntake_programId_intakeYear_key" ON "ProgramIntake"("programId", "intakeYear");

-- CreateIndex
CREATE INDEX "CurriculumCourse_curriculum_idx" ON "CurriculumCourse"("curriculum");

-- CreateIndex
CREATE UNIQUE INDEX "CurriculumCourse_orgId_curriculum_code_key" ON "CurriculumCourse"("orgId", "curriculum", "code");

-- CreateIndex
CREATE INDEX "CurriculumCourseMapping_canonicalSubjectKey_idx" ON "CurriculumCourseMapping"("canonicalSubjectKey");

-- CreateIndex
CREATE UNIQUE INDEX "CurriculumCourseMapping_orgId_courseId_canonicalSubjectKey_key" ON "CurriculumCourseMapping"("orgId", "courseId", "canonicalSubjectKey");

-- CreateIndex
CREATE UNIQUE INDEX "SchoolCourse_orgId_courseId_key" ON "SchoolCourse"("orgId", "courseId");

-- CreateIndex
CREATE INDEX "StudentCourse_orgId_studentId_idx" ON "StudentCourse"("orgId", "studentId");

-- CreateIndex
CREATE INDEX "TranscriptImport_orgId_idx" ON "TranscriptImport"("orgId");

-- CreateIndex
CREATE INDEX "StudentCoursePlan_orgId_studentId_idx" ON "StudentCoursePlan"("orgId", "studentId");

-- CreateIndex
CREATE INDEX "StudentCoursePlanItem_orgId_planId_idx" ON "StudentCoursePlanItem"("orgId", "planId");

-- CreateIndex
CREATE INDEX "RequirementSource_universityId_idx" ON "RequirementSource"("universityId");

-- CreateIndex
CREATE INDEX "RequirementSource_programId_idx" ON "RequirementSource"("programId");

-- CreateIndex
CREATE INDEX "RequirementExtraction_sourceId_idx" ON "RequirementExtraction"("sourceId");

-- CreateIndex
CREATE INDEX "ProgramRequirement_programId_isCurrent_idx" ON "ProgramRequirement"("programId", "isCurrent");

-- CreateIndex
CREATE INDEX "ProgramRequirement_orgId_idx" ON "ProgramRequirement"("orgId");

-- CreateIndex
CREATE INDEX "SubjectRequirement_programRequirementId_idx" ON "SubjectRequirement"("programRequirementId");

-- CreateIndex
CREATE INDEX "LanguageRequirement_programRequirementId_idx" ON "LanguageRequirement"("programRequirementId");

-- CreateIndex
CREATE INDEX "TestRequirement_programRequirementId_idx" ON "TestRequirement"("programRequirementId");

-- CreateIndex
CREATE INDEX "AdditionalRequirement_programRequirementId_idx" ON "AdditionalRequirement"("programRequirementId");

-- CreateIndex
CREATE INDEX "RequirementChange_programId_idx" ON "RequirementChange"("programId");

-- CreateIndex
CREATE INDEX "RequirementMatch_orgId_studentId_idx" ON "RequirementMatch"("orgId", "studentId");

-- CreateIndex
CREATE UNIQUE INDEX "RequirementMatch_studentId_programId_planId_key" ON "RequirementMatch"("studentId", "programId", "planId");

-- CreateIndex
CREATE INDEX "CourseImpactAnalysis_orgId_studentId_idx" ON "CourseImpactAnalysis"("orgId", "studentId");

-- CreateIndex
CREATE INDEX "Application_orgId_studentId_idx" ON "Application"("orgId", "studentId");

-- CreateIndex
CREATE INDEX "ApplicationRequirement_orgId_applicationId_idx" ON "ApplicationRequirement"("orgId", "applicationId");

-- CreateIndex
CREATE INDEX "ApplicationDeadline_programId_intakeYear_idx" ON "ApplicationDeadline"("programId", "intakeYear");

-- CreateIndex
CREATE INDEX "ApplicationDeadline_universityId_intakeYear_idx" ON "ApplicationDeadline"("universityId", "intakeYear");

-- CreateIndex
CREATE INDEX "UniversityProgram_fieldKeys_idx" ON "UniversityProgram"("fieldKeys");

-- AddForeignKey
ALTER TABLE "CurriculumCourseMapping" ADD CONSTRAINT "CurriculumCourseMapping_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "CurriculumCourse"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentCoursePlanItem" ADD CONSTRAINT "StudentCoursePlanItem_planId_fkey" FOREIGN KEY ("planId") REFERENCES "StudentCoursePlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RequirementExtraction" ADD CONSTRAINT "RequirementExtraction_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "RequirementSource"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubjectRequirement" ADD CONSTRAINT "SubjectRequirement_programRequirementId_fkey" FOREIGN KEY ("programRequirementId") REFERENCES "ProgramRequirement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LanguageRequirement" ADD CONSTRAINT "LanguageRequirement_programRequirementId_fkey" FOREIGN KEY ("programRequirementId") REFERENCES "ProgramRequirement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestRequirement" ADD CONSTRAINT "TestRequirement_programRequirementId_fkey" FOREIGN KEY ("programRequirementId") REFERENCES "ProgramRequirement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdditionalRequirement" ADD CONSTRAINT "AdditionalRequirement_programRequirementId_fkey" FOREIGN KEY ("programRequirementId") REFERENCES "ProgramRequirement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApplicationRequirement" ADD CONSTRAINT "ApplicationRequirement_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Global catalog rows (orgId null) are unique by key; school rows stay unique per org.
CREATE UNIQUE INDEX "University_global_key" ON "University"("key") WHERE "orgId" IS NULL;
CREATE UNIQUE INDEX "UniversityProgram_global_key" ON "UniversityProgram"("key") WHERE "orgId" IS NULL;
CREATE UNIQUE INDEX "CurriculumCourse_global_key" ON "CurriculumCourse"("curriculum", "code") WHERE "orgId" IS NULL;
