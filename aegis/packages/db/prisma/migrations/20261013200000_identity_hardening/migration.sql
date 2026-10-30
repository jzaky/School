-- Identity hardening: SSO sessions bound to their organization, MFA attempt counting, TOTP replay protection.
ALTER TABLE "sessions" ADD COLUMN "sso_org_id" UUID, ADD COLUMN "mfa_failures" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "users" ADD COLUMN "mfa_last_step" BIGINT;
