-- Time-limited role assignments: an optional end date on MembershipRole. Expired assignments stop
-- granting permissions on the next request and a daily worker job removes them.
-- MembershipRole already has orgId, so prisma/rls.sql keeps it under tenant isolation.
ALTER TABLE "MembershipRole" ADD COLUMN "expiresAt" TIMESTAMP(3);

CREATE INDEX "MembershipRole_orgId_expiresAt_idx" ON "MembershipRole"("orgId", "expiresAt");
