-- Government reporting: returns built from Horizon data for the school's education authority (census, learner
-- registration list, attendance, staff and results), the files generated from them (version and checksums),
-- submissions with the authority's reference, and a calendar of due dates. Exports and submissions are
-- append-only (see prisma/rls.sql section 10).

-- CreateTable
CREATE TABLE "GovReturn" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "authority" TEXT NOT NULL,
    "asOf" DATE NOT NULL,
    "periodFrom" DATE,
    "label" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "dueDateId" TEXT,
    "signedOffById" TEXT,
    "signedOffName" TEXT,
    "signedOffTitle" TEXT,
    "signedOffAt" TIMESTAMP(3),
    "signedDataHash" TEXT,
    "signedVersion" INTEGER,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GovReturn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GovReturnExport" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "returnId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "format" TEXT NOT NULL,
    "locale" TEXT NOT NULL,
    "fileSha256" TEXT NOT NULL,
    "dataSha256" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "rowCount" INTEGER NOT NULL,
    "problemCount" INTEGER NOT NULL DEFAULT 0,
    "withIds" BOOLEAN NOT NULL DEFAULT false,
    "summary" JSONB,
    "generatedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GovReturnExport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GovSubmission" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "returnId" TEXT NOT NULL,
    "exportId" TEXT NOT NULL,
    "submittedOn" DATE NOT NULL,
    "reference" TEXT NOT NULL,
    "note" TEXT,
    "recordedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GovSubmission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GovDueDate" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "titleEn" TEXT NOT NULL,
    "titleAr" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "dueOn" DATE NOT NULL,
    "notes" TEXT,
    "doneAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GovDueDate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GovReturn_orgId_kind_asOf_idx" ON "GovReturn"("orgId", "kind", "asOf");

-- CreateIndex
CREATE INDEX "GovReturn_orgId_status_idx" ON "GovReturn"("orgId", "status");

-- CreateIndex
CREATE INDEX "GovReturnExport_orgId_returnId_createdAt_idx" ON "GovReturnExport"("orgId", "returnId", "createdAt");

-- CreateIndex
CREATE INDEX "GovSubmission_orgId_returnId_idx" ON "GovSubmission"("orgId", "returnId");

-- CreateIndex
CREATE INDEX "GovSubmission_orgId_createdAt_idx" ON "GovSubmission"("orgId", "createdAt");

-- CreateIndex
CREATE INDEX "GovDueDate_orgId_dueOn_idx" ON "GovDueDate"("orgId", "dueOn");

-- AddForeignKey
ALTER TABLE "GovReturnExport" ADD CONSTRAINT "GovReturnExport_returnId_fkey" FOREIGN KEY ("returnId") REFERENCES "GovReturn"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GovSubmission" ADD CONSTRAINT "GovSubmission_returnId_fkey" FOREIGN KEY ("returnId") REFERENCES "GovReturn"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
