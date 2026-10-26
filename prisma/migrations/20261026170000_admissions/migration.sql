-- Admissions and enrollment: online applications (owned by the family account), documents, conversation and
-- history, capacity per grade and section, re-enrollment windows and responses, and student withdrawals.
-- Every table carries orgId; prisma/rls.sql enables tenant isolation on it automatically.
-- Also adds the built-in Admissions Officer role to every existing school (role sync keeps its permissions current).

-- CreateTable
CREATE TABLE "AdmissionSettings" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "publicOpen" BOOLEAN NOT NULL DEFAULT false,
    "openYearIds" TEXT[],
    "cutoffMonth" INTEGER NOT NULL DEFAULT 12,
    "cutoffDay" INTEGER NOT NULL DEFAULT 31,
    "admissionNoPattern" TEXT NOT NULL DEFAULT '{YYYY}-{SEQ:4}',
    "offerDays" INTEGER NOT NULL DEFAULT 14,
    "documentTypes" JSONB,
    "stages" JSONB,
    "introEn" TEXT,
    "introAr" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdmissionSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdmissionCapacity" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "academicYearId" TEXT NOT NULL,
    "gradeLevel" INTEGER NOT NULL,
    "sectionSeats" INTEGER[],
    "seatFeeFils" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdmissionCapacity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdmissionApplication" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "applicantUserId" TEXT NOT NULL,
    "academicYearId" TEXT NOT NULL,
    "gradeLevel" INTEGER NOT NULL,
    "curriculum" "SchoolCurriculum",
    "stage" TEXT NOT NULL DEFAULT 'DRAFT',
    "stageChangedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submittedAt" TIMESTAMP(3),
    "source" TEXT NOT NULL DEFAULT 'ONLINE',
    "step" TEXT,
    "firstNameEn" TEXT NOT NULL DEFAULT '',
    "lastNameEn" TEXT NOT NULL DEFAULT '',
    "firstNameAr" TEXT,
    "lastNameAr" TEXT,
    "dateOfBirth" TIMESTAMP(3),
    "gender" TEXT,
    "nationality" TEXT,
    "homeLanguage" TEXT,
    "emiratesIdEnc" TEXT,
    "emiratesIdLast4" TEXT,
    "emiratesIdHash" TEXT,
    "passportEnc" TEXT,
    "passportLast4" TEXT,
    "nameDobKey" TEXT,
    "schooling" JSONB,
    "guardians" JSONB,
    "siblings" JSONB,
    "siblingStudentIds" TEXT[],
    "staffChild" BOOLEAN NOT NULL DEFAULT false,
    "staffChildVerified" BOOLEAN NOT NULL DEFAULT false,
    "priorityBoost" INTEGER NOT NULL DEFAULT 0,
    "medicalEnc" TEXT,
    "supportEnc" TEXT,
    "hasMedical" BOOLEAN NOT NULL DEFAULT false,
    "hasSupport" BOOLEAN NOT NULL DEFAULT false,
    "consentAt" TIMESTAMP(3),
    "assessmentAppointmentId" TEXT,
    "assessmentOutcome" TEXT,
    "assessmentNotes" TEXT,
    "offerSection" TEXT,
    "offerMadeAt" TIMESTAMP(3),
    "offerDeadline" TIMESTAMP(3),
    "offerRespondedAt" TIMESTAMP(3),
    "seatFeeFils" INTEGER,
    "seatChargeRef" TEXT,
    "seatPayUrl" TEXT,
    "seatPaidAt" TIMESTAMP(3),
    "seatPaymentRef" TEXT,
    "closedBy" TEXT,
    "closeReason" TEXT,
    "waitlistedAt" TIMESTAMP(3),
    "duplicateFlags" TEXT[],
    "studentId" TEXT,
    "enrolledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdmissionApplication_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdmissionDocument" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "typeKey" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "storageKey" TEXT NOT NULL,
    "checksum" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'RECEIVED',
    "reviewNote" TEXT,
    "uploadedByUserId" TEXT,
    "uploadedByMembershipId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdmissionDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdmissionMessage" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "authorMembershipId" TEXT,
    "authorUserId" TEXT,
    "visibility" "MessageVisibility" NOT NULL DEFAULT 'SHARED',
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdmissionMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdmissionEvent" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "fromStage" TEXT,
    "toStage" TEXT,
    "actorMembershipId" TEXT,
    "actorUserId" TEXT,
    "data" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdmissionEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReenrollmentWindow" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "academicYearId" TEXT NOT NULL,
    "opensAt" TIMESTAMP(3) NOT NULL,
    "closesAt" TIMESTAMP(3) NOT NULL,
    "closedAt" TIMESTAMP(3),
    "messageEn" TEXT,
    "messageAr" TEXT,
    "reminderDays" INTEGER[],
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReenrollmentWindow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReenrollmentResponse" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "windowId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "intent" TEXT NOT NULL,
    "reasonKey" TEXT,
    "reasonNote" TEXT,
    "leavingDate" TIMESTAMP(3),
    "respondedById" TEXT NOT NULL,
    "respondedAt" TIMESTAMP(3) NOT NULL,
    "withdrawalId" TEXT,

    CONSTRAINT "ReenrollmentResponse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StudentWithdrawal" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "leavingDate" TIMESTAMP(3) NOT NULL,
    "reasonKey" TEXT NOT NULL,
    "reasonNote" TEXT,
    "destination" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PLANNED',
    "source" TEXT NOT NULL DEFAULT 'STAFF',
    "tcNumber" TEXT,
    "tcIssuedAt" TIMESTAMP(3),
    "tcDocumentId" TEXT,
    "createdById" TEXT NOT NULL,
    "completedById" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StudentWithdrawal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AdmissionSettings_orgId_key" ON "AdmissionSettings"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "AdmissionCapacity_orgId_academicYearId_gradeLevel_key" ON "AdmissionCapacity"("orgId", "academicYearId", "gradeLevel");

-- CreateIndex
CREATE INDEX "AdmissionApplication_orgId_academicYearId_gradeLevel_stage_idx" ON "AdmissionApplication"("orgId", "academicYearId", "gradeLevel", "stage");

-- CreateIndex
CREATE INDEX "AdmissionApplication_orgId_stage_stageChangedAt_idx" ON "AdmissionApplication"("orgId", "stage", "stageChangedAt");

-- CreateIndex
CREATE INDEX "AdmissionApplication_orgId_applicantUserId_idx" ON "AdmissionApplication"("orgId", "applicantUserId");

-- CreateIndex
CREATE INDEX "AdmissionApplication_orgId_emiratesIdHash_idx" ON "AdmissionApplication"("orgId", "emiratesIdHash");

-- CreateIndex
CREATE INDEX "AdmissionApplication_orgId_nameDobKey_idx" ON "AdmissionApplication"("orgId", "nameDobKey");

-- CreateIndex
CREATE INDEX "AdmissionApplication_orgId_studentId_idx" ON "AdmissionApplication"("orgId", "studentId");

-- CreateIndex
CREATE UNIQUE INDEX "AdmissionApplication_orgId_number_key" ON "AdmissionApplication"("orgId", "number");

-- CreateIndex
CREATE INDEX "AdmissionDocument_orgId_applicationId_idx" ON "AdmissionDocument"("orgId", "applicationId");

-- CreateIndex
CREATE INDEX "AdmissionMessage_orgId_applicationId_createdAt_idx" ON "AdmissionMessage"("orgId", "applicationId", "createdAt");

-- CreateIndex
CREATE INDEX "AdmissionEvent_orgId_applicationId_createdAt_idx" ON "AdmissionEvent"("orgId", "applicationId", "createdAt");

-- CreateIndex
CREATE INDEX "AdmissionEvent_orgId_toStage_idx" ON "AdmissionEvent"("orgId", "toStage");

-- CreateIndex
CREATE INDEX "ReenrollmentWindow_orgId_academicYearId_idx" ON "ReenrollmentWindow"("orgId", "academicYearId");

-- CreateIndex
CREATE INDEX "ReenrollmentResponse_orgId_windowId_intent_idx" ON "ReenrollmentResponse"("orgId", "windowId", "intent");

-- CreateIndex
CREATE UNIQUE INDEX "ReenrollmentResponse_windowId_studentId_key" ON "ReenrollmentResponse"("windowId", "studentId");

-- CreateIndex
CREATE INDEX "StudentWithdrawal_orgId_status_leavingDate_idx" ON "StudentWithdrawal"("orgId", "status", "leavingDate");

-- CreateIndex
CREATE INDEX "StudentWithdrawal_orgId_studentId_idx" ON "StudentWithdrawal"("orgId", "studentId");

-- AddForeignKey
ALTER TABLE "AdmissionDocument" ADD CONSTRAINT "AdmissionDocument_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "AdmissionApplication"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdmissionMessage" ADD CONSTRAINT "AdmissionMessage_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "AdmissionApplication"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdmissionEvent" ADD CONSTRAINT "AdmissionEvent_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "AdmissionApplication"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReenrollmentResponse" ADD CONSTRAINT "ReenrollmentResponse_windowId_fkey" FOREIGN KEY ("windowId") REFERENCES "ReenrollmentWindow"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Built-in Admissions Officer role for schools that already exist. New schools get it from the starter template.
INSERT INTO "Role" ("id", "orgId", "key", "nameEn", "nameAr", "descEn", "descAr", "permissions", "isSystem", "customized", "createdAt", "updatedAt")
SELECT 'r' || substr(md5(o."id" || ':admissions_officer'), 1, 24), o."id", 'admissions_officer', 'Admissions Officer', 'مسؤول القبول والتسجيل',
       'Runs admissions: applications, assessments, offers, enrollment, re-enrollment and leavers.',
       'يدير القبول: الطلبات والتقييمات وعروض القبول والتسجيل وإعادة التسجيل والمغادرين.',
       ARRAY['absence.report', 'services.use', 'people.view', 'safeguarding.refer', 'tasks.use', 'appointments.book', 'calendar.view', 'documents.view', 'ai.use', 'comms.send', 'cases.view', 'admissions.view', 'admissions.manage', 'admissions.enroll', 'appointments.host', 'documents.manage']::TEXT[],
       true, false, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "Organization" o
WHERE NOT EXISTS (SELECT 1 FROM "Role" r WHERE r."orgId" = o."id" AND r."key" = 'admissions_officer');
