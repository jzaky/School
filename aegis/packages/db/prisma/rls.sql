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

-- Platform tables (S8). These hold identities and platform state, so they have no NOT NULL org_id.
-- Rule: with no organization context (platform code: sign-in, sessions, the worker's queue, platform
-- administration) the rows are reachable as before. Inside a tenant transaction (app.current_org set)
-- each table is confined to that organization: its members, their sessions, its own row, its jobs
-- and events. Deployment records are platform-only.
DO $$
DECLARE
  no_org text := 'NULLIF(current_setting(''app.current_org'', true), '''') IS NULL';
  cur_org text := 'NULLIF(current_setting(''app.current_org'', true), '''')::uuid';
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['users','sessions','organizations','jobs','platform_events','deployment_versions']
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE public.%I NO FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS platform_or_tenant ON public.%I', t);
  END LOOP;

  -- Users: members of the current organization. Creating a user row (an invitation for someone new)
  -- reveals nothing, so inserts are allowed in either context.
  EXECUTE format('CREATE POLICY platform_or_tenant ON public.users USING (%s OR EXISTS (SELECT 1 FROM public.memberships m WHERE m.user_id = users.id AND m.org_id = %s)) WITH CHECK (true)', no_org, cur_org);
  EXECUTE format('CREATE POLICY platform_or_tenant ON public.sessions USING (%s OR EXISTS (SELECT 1 FROM public.memberships m WHERE m.user_id = sessions.user_id AND m.org_id = %s)) WITH CHECK (%s OR EXISTS (SELECT 1 FROM public.memberships m WHERE m.user_id = sessions.user_id AND m.org_id = %s))', no_org, cur_org, no_org, cur_org);
  EXECUTE format('CREATE POLICY platform_or_tenant ON public.organizations USING (%s OR id = %s) WITH CHECK (%s OR id = %s)', no_org, cur_org, no_org, cur_org);
  EXECUTE format('CREATE POLICY platform_or_tenant ON public.jobs USING (%s OR org_id = %s) WITH CHECK (%s OR org_id = %s)', no_org, cur_org, no_org, cur_org);
  EXECUTE format('CREATE POLICY platform_or_tenant ON public.platform_events USING (%s OR org_id = %s) WITH CHECK (%s OR org_id = %s)', no_org, cur_org, no_org, cur_org);
  EXECUTE format('CREATE POLICY platform_or_tenant ON public.deployment_versions USING (%s) WITH CHECK (%s)', no_org, no_org);
END $$;

-- Shared rate-limit counters (S14) carry no tenant data and are reached only by platform code.
DO $$
BEGIN
  ALTER TABLE public.rate_limit_buckets ENABLE ROW LEVEL SECURITY;
  ALTER TABLE public.rate_limit_buckets NO FORCE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS platform_only ON public.rate_limit_buckets;
  CREATE POLICY platform_only ON public.rate_limit_buckets
    USING (NULLIF(current_setting('app.current_org', true), '') IS NULL)
    WITH CHECK (NULLIF(current_setting('app.current_org', true), '') IS NULL);
END $$;

-- Integrity triggers: append-only records.
-- One narrow exception (S10): the table owner may DELETE the rows of one organization, named in the
-- transaction-local setting aegis.purge_org, to reset the demo tenant. Every other tenant stays protected
-- throughout, the application role can never use it (it is not the table owner), and UPDATE is never allowed.
CREATE OR REPLACE FUNCTION aegis_forbid_mutation() RETURNS trigger AS $$
DECLARE purge text := NULLIF(current_setting('aegis.purge_org', true), '');
BEGIN
  IF TG_OP = 'DELETE' AND purge IS NOT NULL AND OLD.org_id::text = purge
     AND current_user = (SELECT tableowner FROM pg_tables WHERE schemaname = TG_TABLE_SCHEMA AND tablename = TG_TABLE_NAME) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'AEGIS: % rows are append-only (% not permitted)', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'integrity_constraint_violation';
END $$ LANGUAGE plpgsql;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['evidence_events','evidence_checkpoints','authorization_decisions','approval_responses','execution_receipts','policy_events','autonomy_transitions','attack_simulation_results','model_evaluations','model_stage_changes']
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
  WHERE m.user_id = p_user_id
    -- Platform context only: inside a tenant transaction this cross-tenant lookup returns nothing.
    AND NULLIF(current_setting('app.current_org', true), '') IS NULL
  ORDER BY o.name;
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

-- Cross-tenant reference guard (docs/SECURITY_VALIDATION.md). PostgreSQL checks foreign keys without
-- row-level security, so a tenant that learned another tenant's row id could point its own rows at it.
-- For every single-column foreign key between two tables that both carry org_id, a trigger refuses a
-- reference to a row of another organization. The lookup runs as the table owner (SECURITY DEFINER) so
-- it can see the parent whatever the caller's tenant; it compares organization ids and nothing else.
CREATE OR REPLACE FUNCTION aegis_same_org_reference() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE parent_org uuid;
BEGIN
  EXECUTE format('SELECT org_id FROM public.%I WHERE %I = ($1).%I', TG_ARGV[0], TG_ARGV[2], TG_ARGV[1]) INTO parent_org USING NEW;
  IF parent_org IS NOT NULL AND parent_org <> NEW.org_id THEN
    RAISE EXCEPTION 'AEGIS: %.% refers to a % row of another organization', TG_TABLE_NAME, TG_ARGV[1], TG_ARGV[0]
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION aegis_same_org_reference() FROM PUBLIC;

DO $$
DECLARE r record; trg text;
BEGIN
  -- Drop guards from earlier runs so renamed or removed keys leave nothing behind.
  FOR r IN SELECT tgname, tgrelid::regclass::text AS tbl FROM pg_trigger WHERE tgname LIKE 'org_ref_%' AND NOT tgisinternal LOOP
    EXECUTE format('DROP TRIGGER %I ON %s', r.tgname, r.tbl);
  END LOOP;
  FOR r IN
    SELECT c.conname, child.relname AS child_table, parent.relname AS parent_table, ca.attname AS child_col, pa.attname AS parent_col
    FROM pg_constraint c
    JOIN pg_class child ON child.oid = c.conrelid
    JOIN pg_class parent ON parent.oid = c.confrelid
    JOIN pg_namespace n ON n.oid = child.relnamespace AND n.nspname = 'public'
    JOIN pg_attribute ca ON ca.attrelid = c.conrelid AND ca.attnum = c.conkey[1]
    JOIN pg_attribute pa ON pa.attrelid = c.confrelid AND pa.attnum = c.confkey[1]
    WHERE c.contype = 'f' AND array_length(c.conkey, 1) = 1 AND ca.attname <> 'org_id'
      AND EXISTS (SELECT 1 FROM pg_attribute x WHERE x.attrelid = c.conrelid AND x.attname = 'org_id' AND NOT x.attisdropped)
      AND EXISTS (SELECT 1 FROM pg_attribute x WHERE x.attrelid = c.confrelid AND x.attname = 'org_id' AND NOT x.attisdropped)
  LOOP
    trg := 'org_ref_' || substr(md5(r.conname), 1, 20);
    EXECUTE format('CREATE TRIGGER %I BEFORE INSERT OR UPDATE OF %I ON public.%I FOR EACH ROW EXECUTE FUNCTION aegis_same_org_reference(%L, %L, %L)', trg, r.child_col, r.child_table, r.parent_table, r.child_col, r.parent_col);
  END LOOP;
END $$;

-- The same guard for references that are not foreign keys (kept loose for history, soft deletes or
-- optional links). Each entry is child_table.child_column -> parent_table; entries whose table or column
-- does not exist are skipped, so the list can run before or after a migration that adds one.
DO $$
DECLARE pair text; c_table text; c_col text; p_table text; trg text;
BEGIN
  FOREACH pair IN ARRAY ARRAY[
    'access_review_items.agent_id>agents', 'access_review_items.review_id>access_reviews',
    'payment_documents.reserved_by_request_id>action_requests', 'expense_claims.reserved_by_request_id>action_requests',
    'access_requests.agent_id>agents', 'access_requests.resource_id>resources', 'access_requests.tool_id>tools',
    'action_requests.on_behalf_of_agent_id>agents', 'action_requests.tool_id>tools',
    'agents.model_record_id>ai_models', 'agents.team_id>teams',
    'alerts.agent_id>agents',
    'approval_requests.policy_version_id>policy_versions',
    'attack_simulation_runs.lab_agent_id>agents', 'attack_simulation_runs.target_agent_id>agents',
    'autonomy_change_requests.agent_id>agents', 'autonomy_transitions.agent_id>agents', 'autonomy_transitions.change_request_id>autonomy_change_requests',
    'calibration_profiles.agent_id>agents',
    'ai_gateway_events.provider_id>integrations', 'ai_gateway_events.api_key_id>api_keys',
    'datasets.resource_id>resources',
    'discovery_signals.import_id>discovery_imports',
    'software_evidence.item_id>software_items',
    'discovered_agents.linked_agent_id>agents',
    'execution_grants.integration_id>integrations',
    'incident_events.security_event_id>security_events',
    'invitations.role_id>roles',
    'outcome_labels.action_request_id>action_requests', 'outcome_labels.agent_id>agents',
    'policies.current_version_id>policy_versions',
    'policy_events.version_id>policy_versions',
    'policy_exceptions.agent_id>agents', 'policy_exceptions.policy_id>policies',
    'resources.owner_team_id>teams',
    'security_events.action_request_id>action_requests', 'security_events.agent_id>agents', 'security_events.policy_version_id>policy_versions',
    'team_members.membership_id>memberships'
  ] LOOP
    c_table := split_part(split_part(pair, '>', 1), '.', 1);
    c_col := split_part(split_part(pair, '>', 1), '.', 2);
    p_table := split_part(pair, '>', 2);
    CONTINUE WHEN NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = c_table AND column_name = c_col);
    CONTINUE WHEN NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = p_table AND column_name = 'org_id');
    trg := 'org_ref_' || substr(md5(pair), 1, 20);
    EXECUTE format('CREATE TRIGGER %I BEFORE INSERT OR UPDATE OF %I ON public.%I FOR EACH ROW EXECUTE FUNCTION aegis_same_org_reference(%L, %L, %L)', trg, c_col, c_table, p_table, c_col, 'id');
  END LOOP;
END $$;
