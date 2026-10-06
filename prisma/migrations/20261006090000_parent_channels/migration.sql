-- Web push, WhatsApp opt-in and the fee payment link (parents module).
ALTER TYPE "NotificationChannel" ADD VALUE 'PUSH';

ALTER TABLE "Organization" ADD COLUMN "whatsappKinds" TEXT[];
ALTER TABLE "Organization" ADD COLUMN "feePaymentUrl" TEXT;
ALTER TABLE "Organization" ADD COLUMN "feeContact" TEXT;

CREATE TABLE "PushSubscription" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "deviceLabel" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSuccessAt" TIMESTAMP(3),

    CONSTRAINT "PushSubscription_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WhatsAppOptIn" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "consentedAt" TIMESTAMP(3) NOT NULL,
    "consentVersion" TEXT NOT NULL,
    "withdrawnAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WhatsAppOptIn_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PushSubscription_orgId_endpoint_key" ON "PushSubscription"("orgId", "endpoint");
CREATE INDEX "PushSubscription_orgId_membershipId_idx" ON "PushSubscription"("orgId", "membershipId");
CREATE UNIQUE INDEX "WhatsAppOptIn_membershipId_key" ON "WhatsAppOptIn"("membershipId");
CREATE INDEX "WhatsAppOptIn_orgId_idx" ON "WhatsAppOptIn"("orgId");
