-- Sign-in options per school (SignInPolicy), single sign-on identities (SsoIdentity) and rostering
-- (RosterConnection, RosterRun, RosterRecord, RosterLink). Every table has orgId; prisma/rls.sql isolates them.

-- CreateTable
CREATE TABLE "SignInPolicy" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "methods" TEXT[],
    "staffSsoRequired" BOOLEAN NOT NULL DEFAULT false,
    "allowedDomains" TEXT[],
    "matchBy" TEXT NOT NULL DEFAULT 'EMAIL_OR_EXTERNAL_ID',
    "selfJoinDomains" TEXT[],
    "selfJoinApproval" BOOLEAN NOT NULL DEFAULT true,
    "classlinkTenantId" TEXT,
    "cleverDistrictId" TEXT,
    "microsoftTenantId" TEXT,
    "oidcName" TEXT,
    "oidcIssuer" TEXT,
    "oidcClientId" TEXT,
    "oidcSecretEnc" TEXT,
    "oidcScopes" TEXT NOT NULL DEFAULT 'openid email profile',
    "oidcEmailClaim" TEXT NOT NULL DEFAULT 'email',
    "oidcIdClaim" TEXT NOT NULL DEFAULT 'sub',
    "oidcNameClaim" TEXT NOT NULL DEFAULT 'name',
    "oidcTrustEmail" BOOLEAN NOT NULL DEFAULT false,
    "uaePassEidMatch" BOOLEAN NOT NULL DEFAULT true,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SignInPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SsoIdentity" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "linkedVia" TEXT NOT NULL,
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SsoIdentity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RosterConnection" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "baseUrl" TEXT,
    "authMode" TEXT NOT NULL DEFAULT 'OAUTH1',
    "tokenUrl" TEXT,
    "credentialsEnc" TEXT,
    "schoolIds" TEXT[],
    "options" JSONB,
    "schedule" TEXT NOT NULL DEFAULT 'OFF',
    "hour" INTEGER NOT NULL DEFAULT 3,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "lastSlot" TEXT,
    "lastRunAt" TIMESTAMP(3),
    "lastStatus" TEXT,
    "lastDeltaAt" TIMESTAMP(3),
    "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RosterConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RosterRun" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "connectionId" TEXT,
    "provider" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'API',
    "trigger" TEXT NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'FULL',
    "dryRun" BOOLEAN NOT NULL DEFAULT true,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "phase" TEXT,
    "slot" TEXT,
    "cursor" JSONB,
    "counts" JSONB,
    "issues" JSONB,
    "changes" JSONB,
    "progressDone" INTEGER NOT NULL DEFAULT 0,
    "progressTotal" INTEGER NOT NULL DEFAULT 0,
    "allowMassDelete" BOOLEAN NOT NULL DEFAULT false,
    "errorCode" TEXT,
    "actorId" TEXT,
    "heartbeatAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "appliedAt" TIMESTAMP(3),

    CONSTRAINT "RosterRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RosterRecord" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "hash" TEXT NOT NULL,

    CONSTRAINT "RosterRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RosterLink" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "localId" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "lastSeenRunId" TEXT,
    "deactivatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RosterLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SignInPolicy_orgId_key" ON "SignInPolicy"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "SignInPolicy_classlinkTenantId_key" ON "SignInPolicy"("classlinkTenantId");

-- CreateIndex
CREATE UNIQUE INDEX "SignInPolicy_cleverDistrictId_key" ON "SignInPolicy"("cleverDistrictId");

-- CreateIndex
CREATE INDEX "SsoIdentity_orgId_membershipId_idx" ON "SsoIdentity"("orgId", "membershipId");

-- CreateIndex
CREATE UNIQUE INDEX "SsoIdentity_orgId_provider_subject_key" ON "SsoIdentity"("orgId", "provider", "subject");

-- CreateIndex
CREATE INDEX "RosterConnection_orgId_idx" ON "RosterConnection"("orgId");

-- CreateIndex
CREATE INDEX "RosterRun_orgId_startedAt_idx" ON "RosterRun"("orgId", "startedAt");

-- CreateIndex
CREATE INDEX "RosterRun_status_heartbeatAt_idx" ON "RosterRun"("status", "heartbeatAt");

-- CreateIndex
CREATE UNIQUE INDEX "RosterRun_connectionId_slot_key" ON "RosterRun"("connectionId", "slot");

-- CreateIndex
CREATE INDEX "RosterRecord_orgId_runId_kind_idx" ON "RosterRecord"("orgId", "runId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "RosterRecord_runId_kind_externalId_key" ON "RosterRecord"("runId", "kind", "externalId");

-- CreateIndex
CREATE INDEX "RosterLink_orgId_kind_localId_idx" ON "RosterLink"("orgId", "kind", "localId");

-- CreateIndex
CREATE UNIQUE INDEX "RosterLink_orgId_provider_kind_externalId_key" ON "RosterLink"("orgId", "provider", "kind", "externalId");

-- AddForeignKey
ALTER TABLE "RosterRun" ADD CONSTRAINT "RosterRun_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "RosterConnection"("id") ON DELETE SET NULL ON UPDATE CASCADE;

