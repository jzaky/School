-- CreateEnum
CREATE TYPE "CareerEventKind" AS ENUM ('UNIVERSITY_VISIT', 'FAIR', 'INFO_SESSION');

-- CreateEnum
CREATE TYPE "CareerEventStatus" AS ENUM ('PUBLISHED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "CareerRegistrationStatus" AS ENUM ('REGISTERED', 'CANCELLED');

-- CreateTable
CREATE TABLE "InspectionMapping" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "headingKey" TEXT NOT NULL,
    "framework" "Regulator" NOT NULL,
    "areaEn" TEXT NOT NULL,
    "areaAr" TEXT NOT NULL,
    "noteEn" TEXT,
    "noteAr" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "customized" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InspectionMapping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CareerEvent" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "kind" "CareerEventKind" NOT NULL,
    "status" "CareerEventStatus" NOT NULL DEFAULT 'PUBLISHED',
    "titleEn" TEXT NOT NULL,
    "titleAr" TEXT NOT NULL,
    "descEn" TEXT,
    "descAr" TEXT,
    "universityIds" TEXT[],
    "otherUniversities" TEXT[],
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "locationEn" TEXT,
    "locationAr" TEXT,
    "onlineUrl" TEXT,
    "gradeLevels" INTEGER[],
    "capacity" INTEGER,
    "registrationDeadline" TIMESTAMP(3),
    "organizerId" TEXT NOT NULL,
    "calendarEventId" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CareerEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CareerEventRegistration" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "status" "CareerRegistrationStatus" NOT NULL DEFAULT 'REGISTERED',
    "registeredById" TEXT NOT NULL,
    "registeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cancelledAt" TIMESTAMP(3),
    "attended" BOOLEAN,
    "attendanceMarkedAt" TIMESTAMP(3),
    "attendanceMarkedById" TEXT,

    CONSTRAINT "CareerEventRegistration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PartnerResource" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL,
    "nameAr" TEXT NOT NULL,
    "descEn" TEXT NOT NULL,
    "descAr" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "audience" TEXT[],
    "active" BOOLEAN NOT NULL DEFAULT true,
    "isExample" BOOLEAN NOT NULL DEFAULT false,
    "clickCount" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PartnerResource_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "InspectionMapping_orgId_idx" ON "InspectionMapping"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "InspectionMapping_orgId_headingKey_framework_key" ON "InspectionMapping"("orgId", "headingKey", "framework");

-- CreateIndex
CREATE INDEX "CareerEvent_orgId_startsAt_idx" ON "CareerEvent"("orgId", "startsAt");

-- CreateIndex
CREATE INDEX "CareerEventRegistration_orgId_studentId_idx" ON "CareerEventRegistration"("orgId", "studentId");

-- CreateIndex
CREATE UNIQUE INDEX "CareerEventRegistration_eventId_studentId_key" ON "CareerEventRegistration"("eventId", "studentId");

-- CreateIndex
CREATE INDEX "PartnerResource_orgId_active_idx" ON "PartnerResource"("orgId", "active");

-- AddForeignKey
ALTER TABLE "CareerEventRegistration" ADD CONSTRAINT "CareerEventRegistration_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "CareerEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
