# AEGIS database design

PostgreSQL 16. Schema managed by Prisma migrations in `packages/db/prisma`. Row-level security policies in `packages/db/prisma/rls.sql` are applied by `pnpm db:migrate` after every migration.

## Roles
- `aegis_owner`: owns all objects. Used only for migrations (`MIGRATION_DATABASE_URL`) and the platform-admin module.
- `aegis_app`: the application role (`DATABASE_URL`). Not owner, not superuser, `NOBYPASSRLS`. Has SELECT, INSERT, UPDATE, DELETE on tenant tables except where triggers forbid writes (evidence).

## Tenant isolation
Every table in the tenant group has `org_id uuid not null` with an index. RLS is `ENABLE` and `FORCE` on each. The policy is `org_id = current_setting('app.current_org', true)::uuid`. `tenantDb(orgId)` wraps every call in `SET LOCAL app.current_org`. A query without the setting sees zero rows. Tests in `packages/db/tests/isolation.test.ts`.

Global tables (no `org_id`): `users`, `platform_events`, `frameworks` (shared standards catalog), `controls`, `deployment_versions`. `users` are global because one person may belong to several organizations; what they can see is governed by `memberships`.

## Entity groups

### Identity and organization
- `users` (id, email unique, password_hash, mfa_secret_enc, mfa_enabled, is_platform_admin, status)
- `sessions` (user_id, token_hash, expires_at, revoked_at, ip, user_agent)
- `organizations` (slug, name, settings jsonb, plan, demo_mode)
- `memberships` (org_id, user_id, role_id, status) unique (org_id, user_id)
- `roles` (org_id, key, name, permissions text[], is_system)
- `teams`, `team_members`
- `sso_connections` (org_id, issuer, client_id, client_secret_enc, enabled)
- `api_keys` (org_id, prefix, key_hash, subject_type agent|integration|user, subject_id, scopes, expires_at, revoked_at, last_used_at)
- `invitations`

### Agent registry
- `agents` (org_id, slug, name, description, status draft|registered|active|suspended|revoked|archived, environment, model_provider, model_id, business_owner_id, technical_owner_id, team_id, data_classification_limit, risk_tier, metadata)
- `agent_versions` (agent_id, version, manifest jsonb, deployed_at, notes)
- `agent_tools` (agent_id, tool_id, enabled, scope jsonb)
- `tools` (org_id, key, name, description, integration_id, parameter_schema jsonb, destination_rules jsonb, risk_level)
- `resources` (org_id, key, name, type, classification, owner_team_id, attributes jsonb)
- `permissions` (org_id, agent_id, resource_id, actions text[], constraints jsonb, granted_by, expires_at)

### Policy
- `policies` (org_id, key, name, description, category, status, current_version_id)
- `policy_versions` (policy_id, version, document jsonb, content_hash, state draft|review|active|retired, created_by, approved_by, activated_at, retired_at, change_note)
- `policy_assignments` (org_id, policy_id, target_type agent|team|org, target_id, priority)
- `policy_events` (policy_id, version_id, type created|submitted|approved|activated|deactivated|rolled_back, actor_id, note)

### Gateway and approvals
- `action_requests` (org_id, agent_id, tool_id, action, resource_id, params jsonb, params_hash, idempotency_key unique per org, correlation_id, principal_user_id, environment, status evaluating|allowed|denied|pending_approval|approved|rejected|expired|executed|failed, justification, risk_indicators jsonb, expires_at)
- `authorization_decisions` (action_request_id, result allow|deny|require_approval|error, policy_version_ids uuid[], matched_rule_ids text[], explanation jsonb, evaluator, latency_ms, input_hash)
- `approval_requests` (action_request_id, status pending|approved|rejected|expired|more_info|escalated, required_approvals, required_roles text[], assigned_user_id, escalated_to_user_id, expires_at, request_hash, decided_at)
- `approval_responses` (approval_request_id, user_id, decision approve|reject|request_info|escalate|reassign, comment, request_hash_seen)
- `execution_grants` (action_request_id, token_hash, expires_at, consumed_at)
- `execution_receipts` (action_request_id, status succeeded|failed|skipped, downstream_system, downstream_reference, response_summary jsonb, duration_ms)

### Evidence and monitoring
- `evidence_events` (org_id, seq, type, actor_type, actor_id, subject_type, subject_id, correlation_id, trace_id, payload jsonb, prev_hash, hash, occurred_at) unique (org_id, seq); triggers deny UPDATE/DELETE
- `evidence_checkpoints` (org_id, through_seq, hash, signature, signed_at, key_id)
- `monitoring_rules` (org_id, key, name, definition jsonb, severity, enabled)
- `alerts` (org_id, rule_id, severity, title, detail jsonb, status open|acknowledged|resolved, agent_id)
- `control_mappings` (org_id, framework_control_id, evidence_type, source automated|customer_document|human_validated|missing, status, notes)

### Shield
- `data_classes` (org_id, key, name, detector, pattern, action allow|mask|redact|block|require_approval, enabled)
- `security_events` (org_id, type, severity, agent_id, action_request_id, detail jsonb, status)
- `incidents` (org_id, title, severity, status open|investigating|contained|resolved, assignee_id, summary, timeline jsonb)
- `incident_events` (incident_id, type, actor_id, note, security_event_id)
- `integrations` (org_id, key, name, type, base_url, status active|disabled, webhook_secret_enc, settings)
- `credentials` (org_id, integration_id, name, secret_enc, rotation_due_at, rotated_at, version)

### Audit (assessments)
- `frameworks` (key, name, version, publisher, license_note, is_custom, org_id nullable)
- `controls` (framework_id, code, title, summary, category) summaries are original wording
- `documents` (org_id, title, filename, mime, size, sha256, storage_key, status uploaded|parsed|failed, retention_until)
- `document_chunks` (document_id, org_id, idx, text, tsv tsvector)
- `assessments` (org_id, framework_id, name, scope, status, started_by, completed_at, summary jsonb)
- `evidence_artifacts` (org_id, assessment_id, control_id, document_id, chunk_id, kind automated|document|human, excerpt, score)
- `findings` (assessment_id, control_id, status covered|partial|missing|ambiguous, confidence, rationale, validated_by, validated_at)
- `remediation_tasks` (org_id, finding_id, title, owner_id, due_at, status open|in_progress|review|resolved|reopened)
- `audit_exports` (org_id, kind, format json|pdf, storage_key, created_by)

### Platform
- `notifications` (org_id, user_id, type, title, body, read_at, idempotency_key unique)
- `jobs` (see ADR-0003)
- `platform_events`, `deployment_versions`, `tenants` view over organizations

## Conventions
- Primary keys `uuid` v7-style ordered ids generated in the application.
- `created_at`, `updated_at` on mutable tables; evidence has only `occurred_at`.
- Soft delete is not used for governance records; archival is a status.
- Indexes: every `org_id`, every foreign key, `(org_id, status)` on request tables, `(org_id, occurred_at)` on evidence, GIN on `document_chunks.tsv`.
