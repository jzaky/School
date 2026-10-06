-- Row-Level Security for School Operations OS.
-- Run after every migration (npm run db:migrate does this). Idempotent.
-- The application connects as app_user, which does not own the tables and has no BYPASSRLS,
-- so these policies are enforced for every request. The owner role (migrations, seed) is not affected.

-- 1. Privileges for app_user
GRANT USAGE ON SCHEMA public TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_user;
REVOKE ALL ON TABLE "_prisma_migrations" FROM app_user;

-- Immutable records: the app may add but never change or remove them.
REVOKE UPDATE, DELETE ON TABLE "AuditEvent" FROM app_user;
REVOKE UPDATE, DELETE ON TABLE "CaseNoteVersion" FROM app_user;
REVOKE DELETE ON TABLE "CaseNote" FROM app_user;
REVOKE UPDATE, DELETE ON TABLE "BreakGlassAccess" FROM app_user;
REVOKE UPDATE, DELETE ON TABLE "ParentNotificationDecision" FROM app_user;
REVOKE DELETE ON TABLE "ExternalReferral" FROM app_user;

-- Global reference tables (no orgId): readable by every school, written only by the owner role.
REVOKE INSERT, UPDATE, DELETE ON TABLE "CanonicalSubject" FROM app_user;
REVOKE INSERT, UPDATE, DELETE ON TABLE "FieldOfStudy" FROM app_user;
REVOKE INSERT, UPDATE, DELETE ON TABLE "CareerField" FROM app_user;

-- 2. Tenant isolation on every table with an orgId column
DO $$
DECLARE
  t record;
BEGIN
  FOR t IN
    SELECT c.table_name, c.is_nullable
    FROM information_schema.columns c
    JOIN information_schema.tables tb
      ON tb.table_schema = c.table_schema AND tb.table_name = c.table_name AND tb.table_type = 'BASE TABLE'
    WHERE c.table_schema = 'public' AND c.column_name = 'orgId'
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t.table_name);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t.table_name);
    EXECUTE format('DROP POLICY IF EXISTS global_read ON %I', t.table_name);
    EXECUTE format('DROP POLICY IF EXISTS tenant_insert ON %I', t.table_name);
    EXECUTE format('DROP POLICY IF EXISTS tenant_update ON %I', t.table_name);
    EXECUTE format('DROP POLICY IF EXISTS tenant_delete ON %I', t.table_name);
    IF t.is_nullable = 'YES' THEN
      -- Shared catalog table: rows with a null orgId are the global catalog, readable by every
      -- school and written only by the platform pipeline (owner role). A school may read, add,
      -- change and remove only its own rows.
      EXECUTE format(
        'CREATE POLICY global_read ON %I FOR SELECT
           USING ("orgId" IS NULL OR "orgId" = current_setting(''app.current_org_id'', true))',
        t.table_name);
      EXECUTE format(
        'CREATE POLICY tenant_insert ON %I FOR INSERT
           WITH CHECK ("orgId" = current_setting(''app.current_org_id'', true))',
        t.table_name);
      EXECUTE format(
        'CREATE POLICY tenant_update ON %I FOR UPDATE
           USING ("orgId" = current_setting(''app.current_org_id'', true))
           WITH CHECK ("orgId" = current_setting(''app.current_org_id'', true))',
        t.table_name);
      EXECUTE format(
        'CREATE POLICY tenant_delete ON %I FOR DELETE
           USING ("orgId" = current_setting(''app.current_org_id'', true))',
        t.table_name);
    ELSIF t.table_name = 'Membership' THEN
      -- A signed-in user may also read their own memberships in any org (to pick an org at login).
      EXECUTE format(
        'CREATE POLICY tenant_isolation ON %I
           USING ("orgId" = current_setting(''app.current_org_id'', true)
                  OR "userId" = current_setting(''app.current_user_id'', true))
           WITH CHECK ("orgId" = current_setting(''app.current_org_id'', true))',
        t.table_name);
    ELSE
      EXECUTE format(
        'CREATE POLICY tenant_isolation ON %I
           USING ("orgId" = current_setting(''app.current_org_id'', true))
           WITH CHECK ("orgId" = current_setting(''app.current_org_id'', true))',
        t.table_name);
    END IF;
  END LOOP;
END $$;

-- 3. Organization rows: visible when active, when the user is a member, or when it is the public demo school.
ALTER TABLE "Organization" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS org_read ON "Organization";
DROP POLICY IF EXISTS org_write ON "Organization";
DROP POLICY IF EXISTS org_update ON "Organization";
CREATE POLICY org_read ON "Organization" FOR SELECT
  USING (
    "id" = current_setting('app.current_org_id', true)
    OR "isDemo" = true
    OR "id" IN (SELECT m."orgId" FROM "Membership" m WHERE m."userId" = current_setting('app.current_user_id', true))
  );
CREATE POLICY org_update ON "Organization" FOR UPDATE
  USING ("id" = current_setting('app.current_org_id', true))
  WITH CHECK ("id" = current_setting('app.current_org_id', true));
-- No INSERT or DELETE policy for app_user: organizations are created by platform admin tooling as the owner.

-- 4. Platform marketing and operations tables (no orgId, not school data).
-- Marketing leads and platform settings are only reachable through the owner role (platform admin pages,
-- public lead capture in src/server/marketing). The app role may read uptime samples for /status, nothing else.
REVOKE ALL ON TABLE "MarketingLead" FROM app_user;
REVOKE ALL ON TABLE "PlatformSetting" FROM app_user;
REVOKE INSERT, UPDATE, DELETE ON TABLE "UptimeSample" FROM app_user;
