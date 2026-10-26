-- Indexes found missing while testing a full-size school (1,554 students, see docs/capacity.md).
-- Under row-level security every query also filters on orgId, so "(orgId, x)" and "x" both serve lookups by x.

-- Class rosters (registers, gradebook, class pages, homerooms in reports): Enrollment had no index starting
-- with classId, so every roster read walked the whole (studentId, classId) index. 330 ms to 2 ms at full size.
CREATE INDEX IF NOT EXISTS "Enrollment_classId_status_idx" ON "Enrollment"("classId", "status");
-- Guardians of a student (profiles, fees, notifications): only (guardianId, studentId) existed.
CREATE INDEX IF NOT EXISTS "GuardianLink_studentId_idx" ON "GuardianLink"("studentId");
-- A student's requests and form submissions (student profile).
CREATE INDEX IF NOT EXISTS "Request_orgId_studentId_idx" ON "Request"("orgId", "studentId");
CREATE INDEX IF NOT EXISTS "Submission_orgId_studentId_idx" ON "Submission"("orgId", "studentId");
-- Holders of a role (people, families, admissions, notifications) read the whole MembershipRole table.
CREATE INDEX IF NOT EXISTS "MembershipRole_roleId_idx" ON "MembershipRole"("roleId");
-- Audit events of one kind (census readmissions and similar) scanned every audit row.
CREATE INDEX IF NOT EXISTS "AuditEvent_orgId_action_createdAt_idx" ON "AuditEvent"("orgId", "action", "createdAt");
