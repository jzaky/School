-- AEGIS row-level security and integrity triggers.
-- Applied by scripts/migrate.ts after every Prisma migration, as the owner role.
-- Idempotent: safe to run repeatedly.

DO $$
DECLARE
  app_role text := current_setting('aegis.app_role', true);
  t record;
BEGIN
  IF app_role IS NULL OR app_role = '' THEN
    app_role := 'aegis_app';
  END IF;

  -- Grants: the app role may read and write tables but owns nothing.
  EXECUTE format('GRANT USAGE ON SCHEMA public TO %I', app_role);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO %I', app_role);
  EXECUTE format('GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO %I', app_role);
  EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO %I', app_role);
  EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO %I', app_role);
  EXECUTE format('REVOKE ALL ON TABLE _prisma_migrations FROM %I', app_role);

  -- Tenant tables: every table with a NOT NULL org_id column.
  FOR t IN
    SELECT c.table_name
    FROM information_schema.columns c
    JOIN information_schema.tables tb ON tb.table_name = c.table_name AND tb.table_schema = c.table_schema
    WHERE c.table_schema = 'public' AND c.column_name = 'org_id' AND c.is_nullable = 'NO'
      AND tb.table_type = 'BASE TABLE'
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t.table_name);
    EXECUTE format('ALTER TABLE public.%I NO FORCE ROW LEVEL SECURITY', t.table_name);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON public.%I', t.table_name);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON public.%I USING (org_id = NULLIF(current_setting(''app.current_org'', true), '''')::uuid) WITH CHECK (org_id = NULLIF(current_setting(''app.current_org'', true), '''')::uuid)',
      t.table_name);
  END LOOP;

  -- Shared catalog with optional tenant rows (custom frameworks).
  ALTER TABLE public.frameworks ENABLE ROW LEVEL SECURITY;
  ALTER TABLE public.frameworks NO FORCE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS tenant_or_shared ON public.frameworks;
  CREATE POLICY tenant_or_shared ON public.frameworks
    USING (org_id IS NULL OR org_id = NULLIF(current_setting('app.current_org', true), '')::uuid)
    WITH CHECK (org_id = NULLIF(current_setting('app.current_org', true), '')::uuid);

  -- Controls follow their framework.
  ALTER TABLE public.controls ENABLE ROW LEVEL SECURITY;
  ALTER TABLE public.controls NO FORCE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS via_framework ON public.controls;
  CREATE POLICY via_framework ON public.controls
    USING (EXISTS (SELECT 1 FROM public.frameworks f WHERE f.id = framework_id AND (f.org_id IS NULL OR f.org_id = NULLIF(current_setting('app.current_org', true), '')::uuid)))
    WITH CHECK (EXISTS (SELECT 1 FROM public.frameworks f WHERE f.id = framework_id AND f.org_id = NULLIF(current_setting('app.current_org', true), '')::uuid));

  -- Owner role bypasses RLS implicitly (table owner). Make sure the app role cannot.
  BEGIN
    EXECUTE format('ALTER ROLE %I NOBYPASSRLS', app_role);
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'skipping ALTER ROLE (no CREATEROLE); verify % has NOBYPASSRLS', app_role;
  END;
END $$;

-- Integrity triggers: append-only records.
CREATE OR REPLACE FUNCTION aegis_forbid_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'AEGIS: % rows are append-only (% not permitted)', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'integrity_constraint_violation';
END $$ LANGUAGE plpgsql;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['evidence_events','evidence_checkpoints','authorization_decisions','approval_responses','execution_receipts','policy_events']
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS forbid_mutation ON public.%I', t);
    EXECUTE format('CREATE TRIGGER forbid_mutation BEFORE UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION aegis_forbid_mutation()', t);
  END LOOP;
END $$;

-- Policy versions: the document is frozen once the version leaves draft.
CREATE OR REPLACE FUNCTION aegis_freeze_policy_version() RETURNS trigger AS $$
BEGIN
  IF OLD.state <> 'draft' AND (NEW.document::text <> OLD.document::text OR NEW.content_hash <> OLD.content_hash OR NEW.version <> OLD.version) THEN
    RAISE EXCEPTION 'AEGIS: policy version % is frozen; create a new version instead', OLD.id
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS freeze_policy_version ON public.policy_versions;
CREATE TRIGGER freeze_policy_version BEFORE UPDATE ON public.policy_versions FOR EACH ROW EXECUTE FUNCTION aegis_freeze_policy_version();
DROP TRIGGER IF EXISTS forbid_delete_policy_version ON public.policy_versions;
CREATE TRIGGER forbid_delete_policy_version BEFORE DELETE ON public.policy_versions FOR EACH ROW EXECUTE FUNCTION aegis_forbid_mutation();

-- Full text index for document retrieval.
CREATE INDEX IF NOT EXISTS document_chunks_tsv_idx ON public.document_chunks USING GIN (to_tsvector('english', text));

-- Cross-tenant lookups that must work before a tenant context exists. These functions run as the
-- owner (SECURITY DEFINER) and expose exactly one narrow query each.
CREATE OR REPLACE FUNCTION aegis_resolve_api_key(p_hash text)
RETURNS TABLE (id uuid, org_id uuid, subject_type "ApiKeySubject", subject_id uuid, scopes text[], expires_at timestamp(3), revoked_at timestamp(3))
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT k.id, k.org_id, k.subject_type, k.subject_id, k.scopes, k.expires_at, k.revoked_at
  FROM api_keys k WHERE k.key_hash = p_hash LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION aegis_touch_api_key(p_id uuid) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE api_keys SET last_used_at = now() WHERE id = p_id AND (last_used_at IS NULL OR last_used_at < now() - interval '1 minute');
$$;

CREATE OR REPLACE FUNCTION aegis_user_memberships(p_user_id uuid)
RETURNS TABLE (membership_id uuid, org_id uuid, org_slug text, org_name text, org_demo boolean, role_id uuid, role_key text, role_name text, permissions text[], status "MembershipStatus")
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT m.id, m.org_id, o.slug, o.name, o.demo_mode, r.id, r.key, r.name, r.permissions, m.status
  FROM memberships m JOIN organizations o ON o.id = m.org_id JOIN roles r ON r.id = m.role_id
  WHERE m.user_id = p_user_id ORDER BY o.name;
$$;

CREATE OR REPLACE FUNCTION aegis_invitation_by_hash(p_hash text)
RETURNS TABLE (id uuid, org_id uuid, email text, role_id uuid, expires_at timestamp(3), accepted_at timestamp(3), org_name text)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT i.id, i.org_id, i.email, i.role_id, i.expires_at, i.accepted_at, o.name
  FROM invitations i JOIN organizations o ON o.id = i.org_id WHERE i.token_hash = p_hash LIMIT 1;
$$;

DO $$
DECLARE app_role text := COALESCE(NULLIF(current_setting('aegis.app_role', true), ''), 'aegis_app');
BEGIN
  EXECUTE format('GRANT EXECUTE ON FUNCTION aegis_resolve_api_key(text) TO %I', app_role);
  EXECUTE format('GRANT EXECUTE ON FUNCTION aegis_touch_api_key(uuid) TO %I', app_role);
  EXECUTE format('GRANT EXECUTE ON FUNCTION aegis_user_memberships(uuid) TO %I', app_role);
  EXECUTE format('GRANT EXECUTE ON FUNCTION aegis_invitation_by_hash(text) TO %I', app_role);
END $$;
