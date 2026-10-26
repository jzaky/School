-- Password reset: sessions opened before a reset stop working (src/server/sso/password-reset.ts).
ALTER TABLE "User" ADD COLUMN "sessionsValidFrom" TIMESTAMP(3);
