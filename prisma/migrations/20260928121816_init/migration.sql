-- CreateEnum
CREATE TYPE "Locale" AS ENUM ('en', 'ar');

-- CreateEnum
CREATE TYPE "Sensitivity" AS ENUM ('STANDARD', 'CONFIDENTIAL', 'MEDICAL', 'WELLBEING', 'SAFEGUARDING');

-- CreateEnum
CREATE TYPE "Priority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'URGENT');

-- CreateEnum
CREATE TYPE "MembershipStatus" AS ENUM ('ACTIVE', 'INVITED', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "PersonStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'GRADUATED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "RequestStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'IN_REVIEW', 'PENDING_APPROVAL', 'APPROVED', 'IN_PROGRESS', 'COMPLETED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "CaseType" AS ENUM ('ACADEMIC', 'BEHAVIOR', 'WELLBEING', 'SAFEGUARDING', 'CAREER', 'LEARNING_SUPPORT', 'ATTENDANCE', 'PARENT_CONCERN', 'OTHER');

-- CreateEnum
CREATE TYPE "CaseStatus" AS ENUM ('NEW', 'OPEN', 'IN_PROGRESS', 'WAITING', 'RESOLVED', 'CLOSED');

-- CreateEnum
CREATE TYPE "ConcernLevel" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'IMMEDIATE_DANGER');

-- CreateEnum
CREATE TYPE "CaseNoteKind" AS ENUM ('NOTE', 'DECISION', 'CONTACT', 'ACTION', 'SYSTEM');

-- CreateEnum
CREATE TYPE "ParticipantRole" AS ENUM ('ASSIGNEE', 'REFERRER', 'TEAM', 'GUARDIAN', 'OBSERVER');

-- CreateEnum
CREATE TYPE "ParentNotifyDecision" AS ENUM ('NOTIFY', 'DO_NOT_NOTIFY', 'DEFER');

-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('TODO', 'IN_PROGRESS', 'DONE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "WorkflowStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "WorkflowRunStatus" AS ENUM ('RUNNING', 'WAITING', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "StepRunStatus" AS ENUM ('PENDING', 'RUNNING', 'WAITING', 'COMPLETED', 'FAILED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "ApprovalMode" AS ENUM ('SEQUENTIAL', 'PARALLEL_ALL', 'PARALLEL_ANY');

-- CreateEnum
CREATE TYPE "ApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED', 'WAITING');

-- CreateEnum
CREATE TYPE "HostMode" AS ENUM ('SPECIFIC', 'ROUND_ROBIN');

-- CreateEnum
CREATE TYPE "LocationType" AS ENUM ('IN_PERSON', 'ONLINE', 'PHONE');

-- CreateEnum
CREATE TYPE "AppointmentStatus" AS ENUM ('SCHEDULED', 'CONFIRMED', 'COMPLETED', 'CANCELLED', 'NO_SHOW');

-- CreateEnum
CREATE TYPE "CalendarEventKind" AS ENUM ('EVENT', 'DEADLINE', 'HOLIDAY', 'EXAM', 'FOLLOW_UP');

-- CreateEnum
CREATE TYPE "DocumentSource" AS ENUM ('UPLOAD', 'GENERATED');

-- CreateEnum
CREATE TYPE "DocumentOutput" AS ENUM ('EN', 'AR', 'BILINGUAL');

-- CreateEnum
CREATE TYPE "RecommendationStatus" AS ENUM ('DRAFT', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ShortlistCategory" AS ENUM ('REACH', 'TARGET', 'SAFETY');

-- CreateEnum
CREATE TYPE "ApplicationStatus" AS ENUM ('RESEARCHING', 'PREPARING', 'SUBMITTED', 'OFFER', 'ACCEPTED', 'REJECTED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "MessageChannel" AS ENUM ('INTERNAL', 'EMAIL', 'SMS', 'WHATSAPP');

-- CreateEnum
CREATE TYPE "NotificationChannel" AS ENUM ('IN_APP', 'EMAIL', 'SMS', 'WHATSAPP');

-- CreateEnum
CREATE TYPE "DeliveryStatus" AS ENUM ('QUEUED', 'SENT', 'DELIVERED', 'FAILED');

-- CreateEnum
CREATE TYPE "AiDraftStatus" AS ENUM ('DRAFT', 'ACCEPTED', 'DISCARDED', 'BLOCKED');

-- CreateEnum
CREATE TYPE "ConsentStatus" AS ENUM ('GRANTED', 'WITHDRAWN', 'PENDING', 'REFUSED');

-- CreateEnum
CREATE TYPE "DsrType" AS ENUM ('ACCESS', 'CORRECTION', 'DELETION');

-- CreateEnum
CREATE TYPE "DsrStatus" AS ENUM ('RECEIVED', 'VERIFYING', 'IN_PROGRESS', 'COMPLETED', 'REJECTED');

-- CreateEnum
CREATE TYPE "BreachSeverity" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "BreachStatus" AS ENUM ('OPEN', 'CONTAINED', 'REPORTED', 'CLOSED');

-- CreateEnum
CREATE TYPE "RetentionAction" AS ENUM ('REVIEW', 'ANONYMIZE', 'DELETE');

-- CreateEnum
CREATE TYPE "Regulator" AS ENUM ('KHDA', 'ADEK', 'SPEA', 'MOE', 'OTHER');

-- CreateEnum
CREATE TYPE "IdPolicy" AS ENUM ('OFF', 'OPTIONAL', 'REQUIRED');

-- CreateEnum
CREATE TYPE "Numerals" AS ENUM ('WESTERN', 'ARABIC_INDIC');

-- CreateEnum
CREATE TYPE "AttendanceStatus" AS ENUM ('PRESENT', 'ABSENT', 'LATE', 'EXCUSED');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('RUNNING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "ImportStatus" AS ENUM ('PENDING', 'COMPLETED', 'FAILED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "emailVerified" TIMESTAMP(3),
    "passwordHash" TEXT,
    "nameEn" TEXT NOT NULL,
    "nameAr" TEXT,
    "image" TEXT,
    "locale" "Locale",
    "lastActiveOrgId" TEXT,
    "isPlatformAdmin" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "refresh_token" TEXT,
    "access_token" TEXT,
    "expires_at" INTEGER,
    "token_type" TEXT,
    "scope" TEXT,
    "id_token" TEXT,
    "session_state" TEXT,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VerificationToken" (
    "identifier" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL
);

-- CreateTable
CREATE TABLE "Organization" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL,
    "nameAr" TEXT NOT NULL,
    "shortNameEn" TEXT,
    "shortNameAr" TEXT,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "defaultLocale" "Locale" NOT NULL DEFAULT 'en',
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Dubai',
    "currency" TEXT NOT NULL DEFAULT 'AED',
    "weekDays" INTEGER[] DEFAULT ARRAY[1, 2, 3, 4, 5]::INTEGER[],
    "regulator" "Regulator" NOT NULL DEFAULT 'KHDA',
    "emirate" TEXT NOT NULL DEFAULT 'Dubai',
    "dataRegion" TEXT NOT NULL DEFAULT 'me-central-1',
    "hijriEnabled" BOOLEAN NOT NULL DEFAULT false,
    "numerals" "Numerals" NOT NULL DEFAULT 'WESTERN',
    "aiEnabled" BOOLEAN NOT NULL DEFAULT true,
    "aiSensitiveDataEnabled" BOOLEAN NOT NULL DEFAULT false,
    "aiProviderRegion" TEXT NOT NULL DEFAULT 'global',
    "emiratesIdPolicy" "IdPolicy" NOT NULL DEFAULT 'OPTIONAL',
    "passportPolicy" "IdPolicy" NOT NULL DEFAULT 'OPTIONAL',
    "crossBorderAllowed" BOOLEAN NOT NULL DEFAULT false,
    "primaryColor" TEXT NOT NULL DEFAULT '#0F4C81',
    "accentColor" TEXT NOT NULL DEFAULT '#C8A24A',
    "logoUrl" TEXT,
    "lastResetAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Membership" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "MembershipStatus" NOT NULL DEFAULT 'ACTIVE',
    "titleEn" TEXT,
    "titleAr" TEXT,
    "locale" "Locale",
    "lastSeenAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Membership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Role" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL,
    "nameAr" TEXT NOT NULL,
    "descEn" TEXT,
    "descAr" TEXT,
    "permissions" TEXT[],
    "isSystem" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MembershipRole" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,

    CONSTRAINT "MembershipRole_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Campus" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL,
    "nameAr" TEXT NOT NULL,
    "addressEn" TEXT,
    "addressAr" TEXT,
    "isMain" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Campus_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AcademicYear" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL,
    "nameAr" TEXT NOT NULL,
    "startsOn" TIMESTAMP(3) NOT NULL,
    "endsOn" TIMESTAMP(3) NOT NULL,
    "isCurrent" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AcademicYear_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Term" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "academicYearId" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL,
    "nameAr" TEXT NOT NULL,
    "startsOn" TIMESTAMP(3) NOT NULL,
    "endsOn" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Term_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Department" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL,
    "nameAr" TEXT NOT NULL,
    "headMembershipId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Department_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Subject" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "departmentId" TEXT,
    "code" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL,
    "nameAr" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Subject_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SchoolClass" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "academicYearId" TEXT NOT NULL,
    "campusId" TEXT,
    "subjectId" TEXT,
    "teacherMembershipId" TEXT,
    "nameEn" TEXT NOT NULL,
    "nameAr" TEXT NOT NULL,
    "gradeLevel" INTEGER NOT NULL,
    "section" TEXT,
    "isHomeroom" BOOLEAN NOT NULL DEFAULT false,
    "room" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SchoolClass_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Enrollment" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "classId" TEXT NOT NULL,
    "status" "PersonStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Enrollment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StaffProfile" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "departmentId" TEXT,
    "employeeNo" TEXT,
    "jobTitleEn" TEXT,
    "jobTitleAr" TEXT,
    "phone" TEXT,
    "officeEn" TEXT,
    "officeAr" TEXT,
    "bioEn" TEXT,
    "bioAr" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StaffProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Student" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "membershipId" TEXT,
    "campusId" TEXT,
    "studentNo" TEXT NOT NULL,
    "firstNameEn" TEXT NOT NULL,
    "lastNameEn" TEXT NOT NULL,
    "firstNameAr" TEXT NOT NULL,
    "lastNameAr" TEXT NOT NULL,
    "preferredName" TEXT,
    "gradeLevel" INTEGER NOT NULL,
    "section" TEXT,
    "dateOfBirth" TIMESTAMP(3),
    "gender" TEXT,
    "nationalityEn" TEXT,
    "nationalityAr" TEXT,
    "emiratesIdEnc" TEXT,
    "emiratesIdLast4" TEXT,
    "passportEnc" TEXT,
    "passportLast4" TEXT,
    "status" "PersonStatus" NOT NULL DEFAULT 'ACTIVE',
    "enrolledOn" TIMESTAMP(3),
    "houseEn" TEXT,
    "houseAr" TEXT,
    "photoUrl" TEXT,
    "hasSen" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Student_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Guardian" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "membershipId" TEXT,
    "firstNameEn" TEXT NOT NULL,
    "lastNameEn" TEXT NOT NULL,
    "firstNameAr" TEXT NOT NULL,
    "lastNameAr" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "preferredLoc" "Locale" NOT NULL DEFAULT 'en',
    "occupation" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Guardian_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GuardianLink" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "guardianId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "relationshipEn" TEXT NOT NULL DEFAULT 'Parent',
    "relationshipAr" TEXT NOT NULL DEFAULT 'ولي الأمر',
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "canApprove" BOOLEAN NOT NULL DEFAULT true,
    "receivesUpdates" BOOLEAN NOT NULL DEFAULT true,
    "livesWith" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "GuardianLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StudentMedical" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "allergiesEnc" TEXT,
    "conditionsEnc" TEXT,
    "medicationsEnc" TEXT,
    "hasAlert" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StudentMedical_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AttendanceRecord" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "status" "AttendanceStatus" NOT NULL,
    "minutesLate" INTEGER,

    CONSTRAINT "AttendanceRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServiceCategory" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL,
    "nameAr" TEXT NOT NULL,
    "icon" TEXT NOT NULL DEFAULT 'layers',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ServiceCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServiceDefinition" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL,
    "nameAr" TEXT NOT NULL,
    "descEn" TEXT NOT NULL,
    "descAr" TEXT NOT NULL,
    "icon" TEXT NOT NULL DEFAULT 'file-text',
    "audience" TEXT[],
    "formId" TEXT,
    "workflowId" TEXT,
    "appointmentTypeId" TEXT,
    "slaHours" INTEGER NOT NULL DEFAULT 72,
    "sensitivity" "Sensitivity" NOT NULL DEFAULT 'STANDARD',
    "requestPrefix" TEXT NOT NULL DEFAULT 'REQ',
    "requiresStudent" BOOLEAN NOT NULL DEFAULT true,
    "createsCase" BOOLEAN NOT NULL DEFAULT false,
    "caseType" "CaseType",
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isFeatured" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ServiceDefinition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Form" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL,
    "nameAr" TEXT NOT NULL,
    "descEn" TEXT,
    "descAr" TEXT,
    "categoryEn" TEXT,
    "categoryAr" TEXT,
    "isTemplate" BOOLEAN NOT NULL DEFAULT false,
    "status" "WorkflowStatus" NOT NULL DEFAULT 'DRAFT',
    "draftSchema" JSONB,
    "publishedVersionId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Form_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FormVersion" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "formId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "schema" JSONB NOT NULL,
    "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publishedById" TEXT,

    CONSTRAINT "FormVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FormDraft" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "formVersionId" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "serviceId" TEXT,
    "studentId" TEXT,
    "data" JSONB NOT NULL,
    "step" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FormDraft_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Submission" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "formVersionId" TEXT NOT NULL,
    "submittedById" TEXT NOT NULL,
    "studentId" TEXT,
    "data" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Submission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Request" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "requesterId" TEXT NOT NULL,
    "studentId" TEXT,
    "submissionId" TEXT,
    "caseId" TEXT,
    "status" "RequestStatus" NOT NULL DEFAULT 'SUBMITTED',
    "priority" "Priority" NOT NULL DEFAULT 'MEDIUM',
    "sensitivity" "Sensitivity" NOT NULL DEFAULT 'STANDARD',
    "titleEn" TEXT NOT NULL,
    "titleAr" TEXT NOT NULL,
    "currentStepEn" TEXT,
    "currentStepAr" TEXT,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "assigneeId" TEXT,
    "slaDueAt" TIMESTAMP(3),
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Request_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TimelineEvent" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "requestId" TEXT,
    "caseId" TEXT,
    "studentId" TEXT,
    "actorId" TEXT,
    "kind" TEXT NOT NULL,
    "titleEn" TEXT NOT NULL,
    "titleAr" TEXT NOT NULL,
    "bodyEn" TEXT,
    "bodyAr" TEXT,
    "sensitivity" "Sensitivity" NOT NULL DEFAULT 'STANDARD',
    "staffOnly" BOOLEAN NOT NULL DEFAULT false,
    "data" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TimelineEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Sequence" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Sequence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Workflow" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL,
    "nameAr" TEXT NOT NULL,
    "descEn" TEXT,
    "descAr" TEXT,
    "isTemplate" BOOLEAN NOT NULL DEFAULT false,
    "status" "WorkflowStatus" NOT NULL DEFAULT 'DRAFT',
    "draftGraph" JSONB,
    "publishedVersionId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Workflow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkflowVersion" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "workflowId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "graph" JSONB NOT NULL,
    "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publishedById" TEXT,

    CONSTRAINT "WorkflowVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkflowRun" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "workflowVersionId" TEXT NOT NULL,
    "requestId" TEXT,
    "caseId" TEXT,
    "status" "WorkflowRunStatus" NOT NULL DEFAULT 'RUNNING',
    "context" JSONB NOT NULL,
    "activeNodeIds" TEXT[],
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "error" TEXT,

    CONSTRAINT "WorkflowRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkflowStepRun" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "nodeType" TEXT NOT NULL,
    "status" "StepRunStatus" NOT NULL DEFAULT 'PENDING',
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "idempotencyKey" TEXT NOT NULL,
    "input" JSONB,
    "output" JSONB,
    "error" TEXT,
    "scheduledFor" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "WorkflowStepRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApprovalRequest" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "runId" TEXT,
    "nodeId" TEXT,
    "requestId" TEXT,
    "mode" "ApprovalMode" NOT NULL DEFAULT 'SEQUENTIAL',
    "status" "ApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "titleEn" TEXT NOT NULL,
    "titleAr" TEXT NOT NULL,
    "dueAt" TIMESTAMP(3),
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApprovalRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApprovalAssignee" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "approvalRequestId" TEXT NOT NULL,
    "membershipId" TEXT,
    "guardianId" TEXT,
    "labelEn" TEXT NOT NULL,
    "labelAr" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "status" "ApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "requireSignature" BOOLEAN NOT NULL DEFAULT false,
    "signatureName" TEXT,
    "comment" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decidedById" TEXT,

    CONSTRAINT "ApprovalAssignee_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Case" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "type" "CaseType" NOT NULL,
    "sensitivity" "Sensitivity" NOT NULL DEFAULT 'STANDARD',
    "studentId" TEXT NOT NULL,
    "titleEn" TEXT NOT NULL,
    "titleAr" TEXT NOT NULL,
    "summaryEn" TEXT,
    "summaryAr" TEXT,
    "assigneeId" TEXT,
    "referrerId" TEXT,
    "departmentId" TEXT,
    "priority" "Priority" NOT NULL DEFAULT 'MEDIUM',
    "status" "CaseStatus" NOT NULL DEFAULT 'NEW',
    "concernLevel" "ConcernLevel",
    "slaDueAt" TIMESTAMP(3),
    "nextFollowUpAt" TIMESTAMP(3),
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "retentionUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Case_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CaseNote" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "kind" "CaseNoteKind" NOT NULL DEFAULT 'NOTE',
    "currentVersion" INTEGER NOT NULL DEFAULT 1,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CaseNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CaseNoteVersion" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "noteId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "body" TEXT NOT NULL,
    "editedById" TEXT NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CaseNoteVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CaseParticipant" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "membershipId" TEXT,
    "guardianId" TEXT,
    "role" "ParticipantRole" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CaseParticipant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CaseAccessGrant" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "grantedById" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CaseAccessGrant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExternalReferral" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "agencyEn" TEXT NOT NULL,
    "agencyAr" TEXT,
    "referredAt" TIMESTAMP(3) NOT NULL,
    "referenceNo" TEXT,
    "contactName" TEXT,
    "contactPhone" TEXT,
    "contactEmail" TEXT,
    "notes" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExternalReferral_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ParentNotificationDecision" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "decision" "ParentNotifyDecision" NOT NULL,
    "reason" TEXT NOT NULL,
    "guardianIds" TEXT[],
    "decidedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ParentNotificationDecision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BreakGlassAccess" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BreakGlassAccess_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActionPlan" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "caseId" TEXT,
    "studentId" TEXT NOT NULL,
    "titleEn" TEXT NOT NULL,
    "titleAr" TEXT NOT NULL,
    "status" "AiDraftStatus" NOT NULL DEFAULT 'DRAFT',
    "fromAi" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT NOT NULL,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ActionPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActionPlanItem" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "textEn" TEXT NOT NULL,
    "textAr" TEXT NOT NULL,
    "ownerRole" TEXT NOT NULL,
    "dueAt" TIMESTAMP(3),
    "taskId" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ActionPlanItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Task" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "titleEn" TEXT NOT NULL,
    "titleAr" TEXT NOT NULL,
    "descEn" TEXT,
    "descAr" TEXT,
    "status" "TaskStatus" NOT NULL DEFAULT 'TODO',
    "priority" "Priority" NOT NULL DEFAULT 'MEDIUM',
    "dueAt" TIMESTAMP(3),
    "assigneeId" TEXT,
    "createdById" TEXT,
    "caseId" TEXT,
    "requestId" TEXT,
    "studentId" TEXT,
    "sensitivity" "Sensitivity" NOT NULL DEFAULT 'STANDARD',
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Task_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SavedView" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "membershipId" TEXT,
    "entity" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL,
    "nameAr" TEXT NOT NULL,
    "filters" JSONB NOT NULL,
    "isShared" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SavedView_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppointmentType" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL,
    "nameAr" TEXT NOT NULL,
    "descEn" TEXT,
    "descAr" TEXT,
    "durationMin" INTEGER NOT NULL DEFAULT 30,
    "bufferBeforeMin" INTEGER NOT NULL DEFAULT 0,
    "bufferAfterMin" INTEGER NOT NULL DEFAULT 10,
    "minNoticeMin" INTEGER NOT NULL DEFAULT 240,
    "dailyMax" INTEGER,
    "horizonDays" INTEGER NOT NULL DEFAULT 30,
    "locationType" "LocationType" NOT NULL DEFAULT 'IN_PERSON',
    "locationEn" TEXT,
    "locationAr" TEXT,
    "intakeFormId" TEXT,
    "hostMode" "HostMode" NOT NULL DEFAULT 'SPECIFIC',
    "audience" TEXT[],
    "color" TEXT NOT NULL DEFAULT '#0F4C81',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AppointmentType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppointmentTypeHost" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "typeId" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,

    CONSTRAINT "AppointmentTypeHost_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AvailabilityRule" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "weekday" INTEGER NOT NULL,
    "startMinute" INTEGER NOT NULL,
    "endMinute" INTEGER NOT NULL,

    CONSTRAINT "AvailabilityRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AvailabilityOverride" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "isUnavailable" BOOLEAN NOT NULL DEFAULT true,
    "startMinute" INTEGER,
    "endMinute" INTEGER,
    "reasonEn" TEXT,
    "reasonAr" TEXT,

    CONSTRAINT "AvailabilityOverride_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Appointment" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "typeId" TEXT NOT NULL,
    "hostId" TEXT NOT NULL,
    "bookedById" TEXT NOT NULL,
    "studentId" TEXT,
    "guardianId" TEXT,
    "caseId" TEXT,
    "requestId" TEXT,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "status" "AppointmentStatus" NOT NULL DEFAULT 'CONFIRMED',
    "locationEn" TEXT,
    "locationAr" TEXT,
    "meetingUrl" TEXT,
    "intakeData" JSONB,
    "notesEn" TEXT,
    "cancelReason" TEXT,
    "rescheduledFromId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Appointment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppointmentAttendee" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "appointmentId" TEXT NOT NULL,
    "membershipId" TEXT,
    "guardianId" TEXT,
    "studentId" TEXT,

    CONSTRAINT "AppointmentAttendee_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CalendarEvent" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "kind" "CalendarEventKind" NOT NULL DEFAULT 'EVENT',
    "titleEn" TEXT NOT NULL,
    "titleAr" TEXT NOT NULL,
    "descEn" TEXT,
    "descAr" TEXT,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "allDay" BOOLEAN NOT NULL DEFAULT false,
    "audience" TEXT[],
    "departmentId" TEXT,
    "classId" TEXT,
    "ownerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CalendarEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentCategory" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL,
    "nameAr" TEXT NOT NULL,
    "sensitivity" "Sensitivity" NOT NULL DEFAULT 'STANDARD',

    CONSTRAINT "DocumentCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Document" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "categoryId" TEXT,
    "titleEn" TEXT NOT NULL,
    "titleAr" TEXT NOT NULL,
    "studentId" TEXT,
    "caseId" TEXT,
    "requestId" TEXT,
    "sensitivity" "Sensitivity" NOT NULL DEFAULT 'STANDARD',
    "source" "DocumentSource" NOT NULL DEFAULT 'UPLOAD',
    "templateId" TEXT,
    "currentVersionId" TEXT,
    "expiresAt" TIMESTAMP(3),
    "uploadedById" TEXT NOT NULL,
    "visibleToFamily" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentVersion" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "storageKey" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "checksum" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocumentVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentTemplate" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL,
    "nameAr" TEXT NOT NULL,
    "descEn" TEXT,
    "descAr" TEXT,
    "bodyEn" TEXT NOT NULL,
    "bodyAr" TEXT NOT NULL,
    "output" "DocumentOutput" NOT NULL DEFAULT 'BILINGUAL',
    "mergeFields" TEXT[],
    "signatoryEn" TEXT,
    "signatoryAr" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DocumentTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CareerProfile" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "interestsEn" TEXT[],
    "interestsAr" TEXT[],
    "favoriteSubjects" TEXT[],
    "preferredCountries" TEXT[],
    "goalEn" TEXT,
    "goalAr" TEXT,
    "chosenCareerId" TEXT,
    "advisorId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CareerProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AptitudeQuestion" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "dimension" TEXT NOT NULL,
    "textEn" TEXT NOT NULL,
    "textAr" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "reverse" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "AptitudeQuestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AptitudeAssessment" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "answers" JSONB NOT NULL,
    "scores" JSONB,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AptitudeAssessment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Career" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "titleEn" TEXT NOT NULL,
    "titleAr" TEXT NOT NULL,
    "clusterEn" TEXT NOT NULL,
    "clusterAr" TEXT NOT NULL,
    "summaryEn" TEXT NOT NULL,
    "summaryAr" TEXT NOT NULL,
    "dayInLifeEn" TEXT,
    "dayInLifeAr" TEXT,
    "weights" JSONB NOT NULL,
    "subjects" TEXT[],
    "skillsEn" TEXT[],
    "skillsAr" TEXT[],
    "educationEn" TEXT NOT NULL,
    "educationAr" TEXT NOT NULL,
    "salaryMinAed" INTEGER,
    "salaryMaxAed" INTEGER,
    "outlook" TEXT NOT NULL DEFAULT 'growing',
    "uaeDemand" INTEGER NOT NULL DEFAULT 3,

    CONSTRAINT "Career_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CareerRecommendation" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "assessmentId" TEXT,
    "careerId" TEXT NOT NULL,
    "rank" INTEGER NOT NULL,
    "matchScore" INTEGER NOT NULL,
    "reasoningEn" TEXT NOT NULL,
    "reasoningAr" TEXT NOT NULL,
    "status" "RecommendationStatus" NOT NULL DEFAULT 'DRAFT',
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "chosen" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CareerRecommendation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "University" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL,
    "nameAr" TEXT NOT NULL,
    "countryCode" TEXT NOT NULL,
    "cityEn" TEXT NOT NULL,
    "cityAr" TEXT NOT NULL,
    "worldRank" INTEGER,
    "acceptanceRate" INTEGER,
    "minAverage" INTEGER,
    "programsEn" TEXT[],
    "website" TEXT,
    "deadlineMonth" INTEGER,

    CONSTRAINT "University_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShortlistEntry" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "universityId" TEXT NOT NULL,
    "programEn" TEXT NOT NULL,
    "programAr" TEXT,
    "category" "ShortlistCategory" NOT NULL,
    "status" "ApplicationStatus" NOT NULL DEFAULT 'RESEARCHING',
    "deadline" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShortlistEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShortlistRequirement" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "entryId" TEXT NOT NULL,
    "labelEn" TEXT NOT NULL,
    "labelAr" TEXT NOT NULL,
    "done" BOOLEAN NOT NULL DEFAULT false,
    "dueAt" TIMESTAMP(3),

    CONSTRAINT "ShortlistRequirement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Message" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "caseId" TEXT,
    "requestId" TEXT,
    "channel" "MessageChannel" NOT NULL DEFAULT 'INTERNAL',
    "fromId" TEXT NOT NULL,
    "toLabel" TEXT,
    "toGuardianId" TEXT,
    "subject" TEXT,
    "body" TEXT NOT NULL,
    "status" "DeliveryStatus" NOT NULL DEFAULT 'SENT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "recipientId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "titleEn" TEXT NOT NULL,
    "titleAr" TEXT NOT NULL,
    "bodyEn" TEXT,
    "bodyAr" TEXT,
    "href" TEXT,
    "sensitivity" "Sensitivity" NOT NULL DEFAULT 'STANDARD',
    "urgent" BOOLEAN NOT NULL DEFAULT false,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationPreference" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "channels" "NotificationChannel"[],

    CONSTRAINT "NotificationPreference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MessageTemplate" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "subjectEn" TEXT,
    "subjectAr" TEXT,
    "bodyEn" TEXT NOT NULL,
    "bodyAr" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MessageTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OutboundMessage" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "to" TEXT NOT NULL,
    "templateKey" TEXT,
    "subject" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "status" "DeliveryStatus" NOT NULL DEFAULT 'QUEUED',
    "providerId" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),

    CONSTRAINT "OutboundMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Announcement" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "titleEn" TEXT NOT NULL,
    "titleAr" TEXT NOT NULL,
    "bodyEn" TEXT NOT NULL,
    "bodyAr" TEXT NOT NULL,
    "audience" TEXT[],
    "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "authorId" TEXT,

    CONSTRAINT "Announcement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiInteraction" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "feature" TEXT NOT NULL,
    "locale" "Locale" NOT NULL,
    "sensitive" BOOLEAN NOT NULL DEFAULT false,
    "status" "AiDraftStatus" NOT NULL DEFAULT 'DRAFT',
    "provider" TEXT NOT NULL,
    "model" TEXT,
    "subjectType" TEXT,
    "subjectId" TEXT,
    "output" JSONB,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiInteraction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "actorId" TEXT,
    "actorUserId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "sensitivity" "Sensitivity" NOT NULL DEFAULT 'STANDARD',
    "reason" TEXT,
    "meta" JSONB,
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProcessingPurpose" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL,
    "nameAr" TEXT NOT NULL,
    "descEn" TEXT NOT NULL,
    "descAr" TEXT NOT NULL,
    "lawfulBasis" TEXT NOT NULL,
    "dataCategories" TEXT[],
    "requiresConsent" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "ProcessingPurpose_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConsentRecord" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "purposeId" TEXT NOT NULL,
    "studentId" TEXT,
    "guardianId" TEXT,
    "status" "ConsentStatus" NOT NULL,
    "method" TEXT NOT NULL DEFAULT 'portal',
    "recordedById" TEXT,
    "decidedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "withdrawnAt" TIMESTAMP(3),

    CONSTRAINT "ConsentRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DataSubjectRequest" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "type" "DsrType" NOT NULL,
    "status" "DsrStatus" NOT NULL DEFAULT 'RECEIVED',
    "subjectName" TEXT NOT NULL,
    "requesterName" TEXT NOT NULL,
    "studentId" TEXT,
    "detailsEn" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),
    "handledById" TEXT,
    "resolution" TEXT,

    CONSTRAINT "DataSubjectRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BreachLog" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "titleEn" TEXT NOT NULL,
    "titleAr" TEXT NOT NULL,
    "descriptionEn" TEXT NOT NULL,
    "descriptionAr" TEXT,
    "severity" "BreachSeverity" NOT NULL,
    "status" "BreachStatus" NOT NULL DEFAULT 'OPEN',
    "affectedCount" INTEGER NOT NULL DEFAULT 0,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "detectedAt" TIMESTAMP(3) NOT NULL,
    "reportedToRegulatorAt" TIMESTAMP(3),
    "reportedToSubjectsAt" TIMESTAMP(3),
    "createdById" TEXT,

    CONSTRAINT "BreachLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RetentionPolicy" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "recordType" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL,
    "nameAr" TEXT NOT NULL,
    "retentionDays" INTEGER NOT NULL,
    "action" "RetentionAction" NOT NULL DEFAULT 'REVIEW',
    "lastRunAt" TIMESTAMP(3),
    "lastRunCount" INTEGER,

    CONSTRAINT "RetentionPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrossBorderTransfer" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "providerName" TEXT NOT NULL,
    "countryCode" TEXT NOT NULL,
    "purposeEn" TEXT NOT NULL,
    "purposeAr" TEXT NOT NULL,
    "safeguardEn" TEXT NOT NULL,
    "safeguardAr" TEXT NOT NULL,
    "approved" BOOLEAN NOT NULL DEFAULT false,
    "approvedAt" TIMESTAMP(3),

    CONSTRAINT "CrossBorderTransfer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DemoPersona" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "roleLabelEn" TEXT NOT NULL,
    "roleLabelAr" TEXT NOT NULL,
    "blurbEn" TEXT NOT NULL,
    "blurbAr" TEXT NOT NULL,
    "homePath" TEXT NOT NULL,
    "order" INTEGER NOT NULL,

    CONSTRAINT "DemoPersona_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobRun" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "queue" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'RUNNING',
    "result" JSONB,
    "attempts" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "JobRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CsvImport" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "status" "ImportStatus" NOT NULL DEFAULT 'PENDING',
    "total" INTEGER NOT NULL DEFAULT 0,
    "succeeded" INTEGER NOT NULL DEFAULT 0,
    "failed" INTEGER NOT NULL DEFAULT 0,
    "errors" JSONB,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CsvImport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Account_provider_providerAccountId_key" ON "Account"("provider", "providerAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationToken_identifier_token_key" ON "VerificationToken"("identifier", "token");

-- CreateIndex
CREATE UNIQUE INDEX "Organization_slug_key" ON "Organization"("slug");

-- CreateIndex
CREATE INDEX "Membership_userId_idx" ON "Membership"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Membership_orgId_userId_key" ON "Membership"("orgId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "Role_orgId_key_key" ON "Role"("orgId", "key");

-- CreateIndex
CREATE INDEX "MembershipRole_orgId_idx" ON "MembershipRole"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "MembershipRole_membershipId_roleId_key" ON "MembershipRole"("membershipId", "roleId");

-- CreateIndex
CREATE INDEX "Campus_orgId_idx" ON "Campus"("orgId");

-- CreateIndex
CREATE INDEX "AcademicYear_orgId_idx" ON "AcademicYear"("orgId");

-- CreateIndex
CREATE INDEX "Term_orgId_idx" ON "Term"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "Department_orgId_key_key" ON "Department"("orgId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "Subject_orgId_code_key" ON "Subject"("orgId", "code");

-- CreateIndex
CREATE INDEX "SchoolClass_orgId_idx" ON "SchoolClass"("orgId");

-- CreateIndex
CREATE INDEX "SchoolClass_teacherMembershipId_idx" ON "SchoolClass"("teacherMembershipId");

-- CreateIndex
CREATE INDEX "Enrollment_orgId_idx" ON "Enrollment"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "Enrollment_studentId_classId_key" ON "Enrollment"("studentId", "classId");

-- CreateIndex
CREATE UNIQUE INDEX "StaffProfile_membershipId_key" ON "StaffProfile"("membershipId");

-- CreateIndex
CREATE INDEX "StaffProfile_orgId_idx" ON "StaffProfile"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "Student_membershipId_key" ON "Student"("membershipId");

-- CreateIndex
CREATE INDEX "Student_orgId_gradeLevel_idx" ON "Student"("orgId", "gradeLevel");

-- CreateIndex
CREATE UNIQUE INDEX "Student_orgId_studentNo_key" ON "Student"("orgId", "studentNo");

-- CreateIndex
CREATE UNIQUE INDEX "Guardian_membershipId_key" ON "Guardian"("membershipId");

-- CreateIndex
CREATE INDEX "Guardian_orgId_idx" ON "Guardian"("orgId");

-- CreateIndex
CREATE INDEX "GuardianLink_orgId_idx" ON "GuardianLink"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "GuardianLink_guardianId_studentId_key" ON "GuardianLink"("guardianId", "studentId");

-- CreateIndex
CREATE UNIQUE INDEX "StudentMedical_studentId_key" ON "StudentMedical"("studentId");

-- CreateIndex
CREATE INDEX "StudentMedical_orgId_idx" ON "StudentMedical"("orgId");

-- CreateIndex
CREATE INDEX "AttendanceRecord_orgId_date_idx" ON "AttendanceRecord"("orgId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "AttendanceRecord_studentId_date_key" ON "AttendanceRecord"("studentId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "ServiceCategory_orgId_key_key" ON "ServiceCategory"("orgId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "ServiceDefinition_orgId_key_key" ON "ServiceDefinition"("orgId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "Form_orgId_key_key" ON "Form"("orgId", "key");

-- CreateIndex
CREATE INDEX "FormVersion_orgId_idx" ON "FormVersion"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "FormVersion_formId_version_key" ON "FormVersion"("formId", "version");

-- CreateIndex
CREATE INDEX "FormDraft_orgId_idx" ON "FormDraft"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "FormDraft_formVersionId_membershipId_serviceId_key" ON "FormDraft"("formVersionId", "membershipId", "serviceId");

-- CreateIndex
CREATE INDEX "Submission_orgId_idx" ON "Submission"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "Request_submissionId_key" ON "Request"("submissionId");

-- CreateIndex
CREATE INDEX "Request_orgId_status_idx" ON "Request"("orgId", "status");

-- CreateIndex
CREATE INDEX "Request_requesterId_idx" ON "Request"("requesterId");

-- CreateIndex
CREATE UNIQUE INDEX "Request_orgId_number_key" ON "Request"("orgId", "number");

-- CreateIndex
CREATE INDEX "TimelineEvent_orgId_requestId_idx" ON "TimelineEvent"("orgId", "requestId");

-- CreateIndex
CREATE INDEX "TimelineEvent_orgId_caseId_idx" ON "TimelineEvent"("orgId", "caseId");

-- CreateIndex
CREATE INDEX "TimelineEvent_orgId_studentId_idx" ON "TimelineEvent"("orgId", "studentId");

-- CreateIndex
CREATE UNIQUE INDEX "Sequence_orgId_key_key" ON "Sequence"("orgId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "Workflow_orgId_key_key" ON "Workflow"("orgId", "key");

-- CreateIndex
CREATE INDEX "WorkflowVersion_orgId_idx" ON "WorkflowVersion"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkflowVersion_workflowId_version_key" ON "WorkflowVersion"("workflowId", "version");

-- CreateIndex
CREATE INDEX "WorkflowRun_orgId_status_idx" ON "WorkflowRun"("orgId", "status");

-- CreateIndex
CREATE INDEX "WorkflowStepRun_runId_idx" ON "WorkflowStepRun"("runId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkflowStepRun_orgId_idempotencyKey_key" ON "WorkflowStepRun"("orgId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "ApprovalRequest_orgId_status_idx" ON "ApprovalRequest"("orgId", "status");

-- CreateIndex
CREATE INDEX "ApprovalAssignee_orgId_membershipId_status_idx" ON "ApprovalAssignee"("orgId", "membershipId", "status");

-- CreateIndex
CREATE INDEX "Case_orgId_status_idx" ON "Case"("orgId", "status");

-- CreateIndex
CREATE INDEX "Case_orgId_sensitivity_idx" ON "Case"("orgId", "sensitivity");

-- CreateIndex
CREATE UNIQUE INDEX "Case_orgId_number_key" ON "Case"("orgId", "number");

-- CreateIndex
CREATE INDEX "CaseNote_orgId_caseId_idx" ON "CaseNote"("orgId", "caseId");

-- CreateIndex
CREATE INDEX "CaseNoteVersion_orgId_idx" ON "CaseNoteVersion"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "CaseNoteVersion_noteId_version_key" ON "CaseNoteVersion"("noteId", "version");

-- CreateIndex
CREATE INDEX "CaseParticipant_orgId_caseId_idx" ON "CaseParticipant"("orgId", "caseId");

-- CreateIndex
CREATE INDEX "CaseParticipant_membershipId_idx" ON "CaseParticipant"("membershipId");

-- CreateIndex
CREATE INDEX "CaseAccessGrant_orgId_membershipId_idx" ON "CaseAccessGrant"("orgId", "membershipId");

-- CreateIndex
CREATE INDEX "ExternalReferral_orgId_idx" ON "ExternalReferral"("orgId");

-- CreateIndex
CREATE INDEX "ParentNotificationDecision_orgId_idx" ON "ParentNotificationDecision"("orgId");

-- CreateIndex
CREATE INDEX "BreakGlassAccess_orgId_membershipId_idx" ON "BreakGlassAccess"("orgId", "membershipId");

-- CreateIndex
CREATE INDEX "ActionPlan_orgId_studentId_idx" ON "ActionPlan"("orgId", "studentId");

-- CreateIndex
CREATE INDEX "ActionPlanItem_orgId_idx" ON "ActionPlanItem"("orgId");

-- CreateIndex
CREATE INDEX "Task_orgId_assigneeId_status_idx" ON "Task"("orgId", "assigneeId", "status");

-- CreateIndex
CREATE INDEX "Task_orgId_caseId_idx" ON "Task"("orgId", "caseId");

-- CreateIndex
CREATE INDEX "SavedView_orgId_entity_idx" ON "SavedView"("orgId", "entity");

-- CreateIndex
CREATE UNIQUE INDEX "AppointmentType_orgId_key_key" ON "AppointmentType"("orgId", "key");

-- CreateIndex
CREATE INDEX "AppointmentTypeHost_orgId_idx" ON "AppointmentTypeHost"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "AppointmentTypeHost_typeId_membershipId_key" ON "AppointmentTypeHost"("typeId", "membershipId");

-- CreateIndex
CREATE INDEX "AvailabilityRule_orgId_membershipId_idx" ON "AvailabilityRule"("orgId", "membershipId");

-- CreateIndex
CREATE INDEX "AvailabilityOverride_orgId_membershipId_date_idx" ON "AvailabilityOverride"("orgId", "membershipId", "date");

-- CreateIndex
CREATE INDEX "Appointment_orgId_hostId_startsAt_idx" ON "Appointment"("orgId", "hostId", "startsAt");

-- CreateIndex
CREATE INDEX "Appointment_orgId_studentId_idx" ON "Appointment"("orgId", "studentId");

-- CreateIndex
CREATE INDEX "AppointmentAttendee_orgId_membershipId_idx" ON "AppointmentAttendee"("orgId", "membershipId");

-- CreateIndex
CREATE INDEX "CalendarEvent_orgId_startsAt_idx" ON "CalendarEvent"("orgId", "startsAt");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentCategory_orgId_key_key" ON "DocumentCategory"("orgId", "key");

-- CreateIndex
CREATE INDEX "Document_orgId_studentId_idx" ON "Document"("orgId", "studentId");

-- CreateIndex
CREATE INDEX "DocumentVersion_orgId_idx" ON "DocumentVersion"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentVersion_documentId_version_key" ON "DocumentVersion"("documentId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentTemplate_orgId_key_key" ON "DocumentTemplate"("orgId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "CareerProfile_studentId_key" ON "CareerProfile"("studentId");

-- CreateIndex
CREATE INDEX "CareerProfile_orgId_idx" ON "CareerProfile"("orgId");

-- CreateIndex
CREATE INDEX "AptitudeQuestion_orgId_idx" ON "AptitudeQuestion"("orgId");

-- CreateIndex
CREATE INDEX "AptitudeAssessment_orgId_studentId_idx" ON "AptitudeAssessment"("orgId", "studentId");

-- CreateIndex
CREATE UNIQUE INDEX "Career_orgId_key_key" ON "Career"("orgId", "key");

-- CreateIndex
CREATE INDEX "CareerRecommendation_orgId_studentId_idx" ON "CareerRecommendation"("orgId", "studentId");

-- CreateIndex
CREATE UNIQUE INDEX "University_orgId_key_key" ON "University"("orgId", "key");

-- CreateIndex
CREATE INDEX "ShortlistEntry_orgId_studentId_idx" ON "ShortlistEntry"("orgId", "studentId");

-- CreateIndex
CREATE INDEX "ShortlistRequirement_orgId_idx" ON "ShortlistRequirement"("orgId");

-- CreateIndex
CREATE INDEX "Message_orgId_caseId_idx" ON "Message"("orgId", "caseId");

-- CreateIndex
CREATE INDEX "Message_orgId_requestId_idx" ON "Message"("orgId", "requestId");

-- CreateIndex
CREATE INDEX "Notification_orgId_recipientId_readAt_idx" ON "Notification"("orgId", "recipientId", "readAt");

-- CreateIndex
CREATE INDEX "NotificationPreference_orgId_idx" ON "NotificationPreference"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationPreference_membershipId_kind_key" ON "NotificationPreference"("membershipId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "MessageTemplate_orgId_key_channel_key" ON "MessageTemplate"("orgId", "key", "channel");

-- CreateIndex
CREATE UNIQUE INDEX "OutboundMessage_orgId_idempotencyKey_key" ON "OutboundMessage"("orgId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "Announcement_orgId_publishedAt_idx" ON "Announcement"("orgId", "publishedAt");

-- CreateIndex
CREATE INDEX "AiInteraction_orgId_membershipId_idx" ON "AiInteraction"("orgId", "membershipId");

-- CreateIndex
CREATE INDEX "AuditEvent_orgId_entityType_entityId_idx" ON "AuditEvent"("orgId", "entityType", "entityId");

-- CreateIndex
CREATE INDEX "AuditEvent_orgId_createdAt_idx" ON "AuditEvent"("orgId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ProcessingPurpose_orgId_key_key" ON "ProcessingPurpose"("orgId", "key");

-- CreateIndex
CREATE INDEX "ConsentRecord_orgId_studentId_idx" ON "ConsentRecord"("orgId", "studentId");

-- CreateIndex
CREATE UNIQUE INDEX "DataSubjectRequest_orgId_number_key" ON "DataSubjectRequest"("orgId", "number");

-- CreateIndex
CREATE INDEX "BreachLog_orgId_idx" ON "BreachLog"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "RetentionPolicy_orgId_recordType_key" ON "RetentionPolicy"("orgId", "recordType");

-- CreateIndex
CREATE INDEX "CrossBorderTransfer_orgId_idx" ON "CrossBorderTransfer"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "DemoPersona_orgId_key_key" ON "DemoPersona"("orgId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "JobRun_orgId_idempotencyKey_key" ON "JobRun"("orgId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "CsvImport_orgId_idx" ON "CsvImport"("orgId");

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MembershipRole" ADD CONSTRAINT "MembershipRole_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "Membership"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MembershipRole" ADD CONSTRAINT "MembershipRole_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Term" ADD CONSTRAINT "Term_academicYearId_fkey" FOREIGN KEY ("academicYearId") REFERENCES "AcademicYear"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subject" ADD CONSTRAINT "Subject_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SchoolClass" ADD CONSTRAINT "SchoolClass_academicYearId_fkey" FOREIGN KEY ("academicYearId") REFERENCES "AcademicYear"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SchoolClass" ADD CONSTRAINT "SchoolClass_campusId_fkey" FOREIGN KEY ("campusId") REFERENCES "Campus"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SchoolClass" ADD CONSTRAINT "SchoolClass_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "Subject"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Enrollment" ADD CONSTRAINT "Enrollment_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Enrollment" ADD CONSTRAINT "Enrollment_classId_fkey" FOREIGN KEY ("classId") REFERENCES "SchoolClass"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffProfile" ADD CONSTRAINT "StaffProfile_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "Membership"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffProfile" ADD CONSTRAINT "StaffProfile_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Student" ADD CONSTRAINT "Student_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "Membership"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Student" ADD CONSTRAINT "Student_campusId_fkey" FOREIGN KEY ("campusId") REFERENCES "Campus"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Guardian" ADD CONSTRAINT "Guardian_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "Membership"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GuardianLink" ADD CONSTRAINT "GuardianLink_guardianId_fkey" FOREIGN KEY ("guardianId") REFERENCES "Guardian"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GuardianLink" ADD CONSTRAINT "GuardianLink_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentMedical" ADD CONSTRAINT "StudentMedical_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceRecord" ADD CONSTRAINT "AttendanceRecord_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceDefinition" ADD CONSTRAINT "ServiceDefinition_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "ServiceCategory"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceDefinition" ADD CONSTRAINT "ServiceDefinition_formId_fkey" FOREIGN KEY ("formId") REFERENCES "Form"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceDefinition" ADD CONSTRAINT "ServiceDefinition_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "Workflow"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FormVersion" ADD CONSTRAINT "FormVersion_formId_fkey" FOREIGN KEY ("formId") REFERENCES "Form"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FormDraft" ADD CONSTRAINT "FormDraft_formVersionId_fkey" FOREIGN KEY ("formVersionId") REFERENCES "FormVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Submission" ADD CONSTRAINT "Submission_formVersionId_fkey" FOREIGN KEY ("formVersionId") REFERENCES "FormVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Request" ADD CONSTRAINT "Request_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "ServiceDefinition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Request" ADD CONSTRAINT "Request_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Request" ADD CONSTRAINT "Request_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "Submission"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Request" ADD CONSTRAINT "Request_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "Case"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowVersion" ADD CONSTRAINT "WorkflowVersion_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "Workflow"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowRun" ADD CONSTRAINT "WorkflowRun_workflowVersionId_fkey" FOREIGN KEY ("workflowVersionId") REFERENCES "WorkflowVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowRun" ADD CONSTRAINT "WorkflowRun_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "Request"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowStepRun" ADD CONSTRAINT "WorkflowStepRun_runId_fkey" FOREIGN KEY ("runId") REFERENCES "WorkflowRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalRequest" ADD CONSTRAINT "ApprovalRequest_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "Request"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalAssignee" ADD CONSTRAINT "ApprovalAssignee_approvalRequestId_fkey" FOREIGN KEY ("approvalRequestId") REFERENCES "ApprovalRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Case" ADD CONSTRAINT "Case_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Case" ADD CONSTRAINT "Case_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaseNote" ADD CONSTRAINT "CaseNote_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "Case"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaseNoteVersion" ADD CONSTRAINT "CaseNoteVersion_noteId_fkey" FOREIGN KEY ("noteId") REFERENCES "CaseNote"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaseParticipant" ADD CONSTRAINT "CaseParticipant_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "Case"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaseAccessGrant" ADD CONSTRAINT "CaseAccessGrant_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "Case"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExternalReferral" ADD CONSTRAINT "ExternalReferral_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "Case"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ParentNotificationDecision" ADD CONSTRAINT "ParentNotificationDecision_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "Case"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BreakGlassAccess" ADD CONSTRAINT "BreakGlassAccess_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "Case"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActionPlan" ADD CONSTRAINT "ActionPlan_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "Case"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActionPlanItem" ADD CONSTRAINT "ActionPlanItem_planId_fkey" FOREIGN KEY ("planId") REFERENCES "ActionPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AppointmentTypeHost" ADD CONSTRAINT "AppointmentTypeHost_typeId_fkey" FOREIGN KEY ("typeId") REFERENCES "AppointmentType"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_typeId_fkey" FOREIGN KEY ("typeId") REFERENCES "AppointmentType"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AppointmentAttendee" ADD CONSTRAINT "AppointmentAttendee_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "DocumentCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentVersion" ADD CONSTRAINT "DocumentVersion_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CareerProfile" ADD CONSTRAINT "CareerProfile_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AptitudeAssessment" ADD CONSTRAINT "AptitudeAssessment_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CareerRecommendation" ADD CONSTRAINT "CareerRecommendation_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CareerRecommendation" ADD CONSTRAINT "CareerRecommendation_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "AptitudeAssessment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CareerRecommendation" ADD CONSTRAINT "CareerRecommendation_careerId_fkey" FOREIGN KEY ("careerId") REFERENCES "Career"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShortlistEntry" ADD CONSTRAINT "ShortlistEntry_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShortlistEntry" ADD CONSTRAINT "ShortlistEntry_universityId_fkey" FOREIGN KEY ("universityId") REFERENCES "University"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShortlistRequirement" ADD CONSTRAINT "ShortlistRequirement_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "ShortlistEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsentRecord" ADD CONSTRAINT "ConsentRecord_purposeId_fkey" FOREIGN KEY ("purposeId") REFERENCES "ProcessingPurpose"("id") ON DELETE CASCADE ON UPDATE CASCADE;
