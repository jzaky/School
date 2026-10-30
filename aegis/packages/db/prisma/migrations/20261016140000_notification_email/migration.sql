-- Email copy of notifications (packages/core/src/notify/email.ts).
ALTER TABLE "notifications" ADD COLUMN "emailed_at" TIMESTAMP(3);
ALTER TABLE "notifications" ADD COLUMN "email_attempts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "notifications" ADD COLUMN "email_error" TEXT;
CREATE INDEX "notifications_email_pending_idx" ON "notifications" ("org_id", "created_at") WHERE "emailed_at" IS NULL;
