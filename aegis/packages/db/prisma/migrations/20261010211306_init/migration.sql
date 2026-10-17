-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('active', 'disabled');

-- CreateEnum
CREATE TYPE "MembershipStatus" AS ENUM ('active', 'invited', 'suspended');

-- CreateEnum
CREATE TYPE "ApiKeySubject" AS ENUM ('agent', 'integration', 'user');

-- CreateEnum
CREATE TYPE "AgentStatus" AS ENUM ('draft', 'registered', 'active', 'suspended', 'revoked', 'archived');

-- CreateEnum
CREATE TYPE "Environment" AS ENUM ('development', 'staging', 'production');

-- CreateEnum
CREATE TYPE "DataClassification" AS ENUM ('public', 'internal', 'confidential', 'restricted');

-- CreateEnum
CREATE TYPE "IntegrationStatus" AS ENUM ('active', 'disabled');

-- CreateEnum
CREATE TYPE "PolicyVersionState" AS ENUM ('draft', 'review', 'active', 'retired');

-- CreateEnum
CREATE TYPE "PolicyTargetType" AS ENUM ('agent', 'team', 'org');

-- CreateEnum
CREATE TYPE "ActionRequestStatus" AS ENUM ('evaluating', 'allowed', 'denied', 'pending_approval', 'approved', 'rejected', 'expired', 'executed', 'failed');

-- CreateEnum
CREATE TYPE "DecisionResult" AS ENUM ('allow', 'deny', 'require_approval', 'error');

-- CreateEnum
CREATE TYPE "ApprovalStatus" AS ENUM ('pending', 'approved', 'rejected', 'expired', 'more_info', 'escalated');

-- CreateEnum
CREATE TYPE "ApprovalDecision" AS ENUM ('approve', 'reject', 'request_info', 'escalate', 'reassign', 'info_provided');

-- CreateEnum
CREATE TYPE "ReceiptStatus" AS ENUM ('succeeded', 'failed', 'skipped');

-- CreateEnum
CREATE TYPE "AlertStatus" AS ENUM ('open', 'acknowledged', 'resolved');

-- CreateEnum
CREATE TYPE "EvidenceSource" AS ENUM ('automated', 'customer_document', 'human_validated', 'missing');

-- CreateEnum
CREATE TYPE "DataAction" AS ENUM ('allow', 'mask', 'redact', 'block', 'require_approval');

-- CreateEnum
CREATE TYPE "SecurityEventStatus" AS ENUM ('open', 'triaged', 'dismissed', 'linked');

-- CreateEnum
CREATE TYPE "IncidentStatus" AS ENUM ('open', 'investigating', 'contained', 'resolved');

-- CreateEnum
CREATE TYPE "DocumentStatus" AS ENUM ('uploaded', 'parsing', 'parsed', 'failed');

-- CreateEnum
CREATE TYPE "AssessmentStatus" AS ENUM ('draft', 'running', 'completed', 'failed');

-- CreateEnum
CREATE TYPE "FindingStatus" AS ENUM ('covered', 'partial', 'missing', 'ambiguous');

-- CreateEnum
CREATE TYPE "ArtifactKind" AS ENUM ('automated', 'document', 'human');

-- CreateEnum
CREATE TYPE "RemediationStatus" AS ENUM ('open', 'in_progress', 'review', 'resolved', 'reopened');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('pending', 'running', 'done', 'failed');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "password_hash" TEXT,
    "mfa_secret_enc" TEXT,
    "mfa_enabled" BOOLEAN NOT NULL DEFAULT false,
    "is_platform_admin" BOOLEAN NOT NULL DEFAULT false,
    "status" "UserStatus" NOT NULL DEFAULT 'active',
    "failed_logins" INTEGER NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMP(3),
    "last_login_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "active_org_id" UUID,
    "mfa_passed" BOOLEAN NOT NULL DEFAULT false,
    "ip" TEXT,
    "user_agent" TEXT,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organizations" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "plan" TEXT NOT NULL DEFAULT 'enterprise_trial',
    "demo_mode" BOOLEAN NOT NULL DEFAULT false,
    "settings" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roles" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "permissions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "memberships" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role_id" UUID NOT NULL,
    "status" "MembershipStatus" NOT NULL DEFAULT 'active',
    "title" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "teams" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "teams_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "team_members" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "team_id" UUID NOT NULL,
    "membership_id" UUID NOT NULL,
    "is_lead" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "team_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invitations" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "role_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "invited_by" UUID NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "accepted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invitations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sso_connections" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "issuer" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "client_secret_enc" TEXT NOT NULL,
    "email_domains" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sso_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "api_keys" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "key_hash" TEXT NOT NULL,
    "subject_type" "ApiKeySubject" NOT NULL,
    "subject_id" UUID NOT NULL,
    "scopes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "expires_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "last_used_at" TIMESTAMP(3),
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "api_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agents" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "status" "AgentStatus" NOT NULL DEFAULT 'draft',
    "environment" "Environment" NOT NULL DEFAULT 'development',
    "model_provider" TEXT NOT NULL DEFAULT '',
    "model_id" TEXT NOT NULL DEFAULT '',
    "business_owner_id" UUID,
    "technical_owner_id" UUID,
    "team_id" UUID,
    "data_classification_limit" "DataClassification" NOT NULL DEFAULT 'internal',
    "risk_tier" TEXT NOT NULL DEFAULT 'medium',
    "current_version" INTEGER NOT NULL DEFAULT 1,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "status_reason" TEXT,
    "status_changed_at" TIMESTAMP(3),
    "last_activity_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_versions" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "agent_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "manifest" JSONB NOT NULL DEFAULT '{}',
    "notes" TEXT NOT NULL DEFAULT '',
    "deployed_at" TIMESTAMP(3),
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integrations" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "base_url" TEXT,
    "status" "IntegrationStatus" NOT NULL DEFAULT 'active',
    "status_reason" TEXT,
    "webhook_secret_enc" TEXT,
    "settings" JSONB NOT NULL DEFAULT '{}',
    "last_health_at" TIMESTAMP(3),
    "last_health_ok" BOOLEAN,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "integrations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "credentials" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "integration_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "secret_enc" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "rotation_due_at" TIMESTAMP(3),
    "rotated_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "credentials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tools" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "integration_id" UUID,
    "parameter_schema" JSONB NOT NULL DEFAULT '{}',
    "destination_rules" JSONB NOT NULL DEFAULT '{}',
    "risk_level" TEXT NOT NULL DEFAULT 'medium',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "disabled_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tools_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_tools" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "agent_id" UUID NOT NULL,
    "tool_id" UUID NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "revoked_at" TIMESTAMP(3),
    "revoked_reason" TEXT,
    "scope" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_tools_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "resources" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "classification" "DataClassification" NOT NULL DEFAULT 'internal',
    "owner_team_id" UUID,
    "attributes" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "resources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "permissions" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "agent_id" UUID NOT NULL,
    "resource_id" UUID NOT NULL,
    "actions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "constraints" JSONB NOT NULL DEFAULT '{}',
    "granted_by" UUID,
    "expires_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "policies" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "category" TEXT NOT NULL DEFAULT 'authorization',
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "current_version_id" UUID,
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "policy_versions" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "policy_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "document" JSONB NOT NULL,
    "content_hash" TEXT NOT NULL,
    "state" "PolicyVersionState" NOT NULL DEFAULT 'draft',
    "change_note" TEXT NOT NULL DEFAULT '',
    "created_by" UUID,
    "approved_by" UUID,
    "activated_at" TIMESTAMP(3),
    "retired_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "policy_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "policy_assignments" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "policy_id" UUID NOT NULL,
    "target_type" "PolicyTargetType" NOT NULL,
    "target_id" UUID,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "policy_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "policy_events" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "policy_id" UUID NOT NULL,
    "version_id" UUID,
    "type" TEXT NOT NULL,
    "actor_id" UUID,
    "note" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "policy_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "action_requests" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "agent_id" UUID NOT NULL,
    "tool_id" UUID,
    "tool_key" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "resource_key" TEXT,
    "params" JSONB NOT NULL DEFAULT '{}',
    "params_hash" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "correlation_id" TEXT NOT NULL,
    "trace_id" TEXT,
    "principal_user_id" UUID,
    "principal_ref" TEXT,
    "environment" "Environment" NOT NULL DEFAULT 'development',
    "status" "ActionRequestStatus" NOT NULL DEFAULT 'evaluating',
    "justification" TEXT NOT NULL DEFAULT '',
    "risk_indicators" JSONB NOT NULL DEFAULT '[]',
    "context" JSONB NOT NULL DEFAULT '{}',
    "expires_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "action_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "authorization_decisions" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "action_request_id" UUID NOT NULL,
    "result" "DecisionResult" NOT NULL,
    "policy_version_ids" UUID[] DEFAULT ARRAY[]::UUID[],
    "matched_rule_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "explanation" JSONB NOT NULL DEFAULT '{}',
    "evaluator" TEXT NOT NULL DEFAULT 'aegis-deterministic',
    "input_hash" TEXT NOT NULL,
    "latency_ms" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "authorization_decisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approval_requests" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "action_request_id" UUID NOT NULL,
    "status" "ApprovalStatus" NOT NULL DEFAULT 'pending',
    "required_approvals" INTEGER NOT NULL DEFAULT 1,
    "required_roles" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "assigned_user_id" UUID,
    "escalated_to_user_id" UUID,
    "request_hash" TEXT NOT NULL,
    "triggering_rule_id" TEXT,
    "policy_version_id" UUID,
    "reason" TEXT NOT NULL DEFAULT '',
    "expires_at" TIMESTAMP(3) NOT NULL,
    "decided_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "approval_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approval_responses" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "approval_request_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "decision" "ApprovalDecision" NOT NULL,
    "comment" TEXT NOT NULL DEFAULT '',
    "request_hash_seen" TEXT NOT NULL,
    "target_user_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "approval_responses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "execution_grants" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "action_request_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "request_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "consumed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "execution_grants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "execution_receipts" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "action_request_id" UUID NOT NULL,
    "status" "ReceiptStatus" NOT NULL,
    "downstream_system" TEXT NOT NULL,
    "downstream_reference" TEXT,
    "response_summary" JSONB NOT NULL DEFAULT '{}',
    "duration_ms" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "execution_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "evidence_events" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "seq" BIGINT NOT NULL,
    "type" TEXT NOT NULL,
    "actor_type" TEXT NOT NULL,
    "actor_id" TEXT,
    "subject_type" TEXT NOT NULL,
    "subject_id" TEXT,
    "correlation_id" TEXT,
    "trace_id" TEXT,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "prev_hash" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "evidence_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "evidence_checkpoints" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "through_seq" BIGINT NOT NULL,
    "hash" TEXT NOT NULL,
    "signature" TEXT NOT NULL,
    "key_id" TEXT NOT NULL,
    "signed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "evidence_checkpoints_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "monitoring_rules" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "definition" JSONB NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'medium',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "last_run_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "monitoring_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "alerts" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "rule_id" UUID,
    "severity" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "detail" JSONB NOT NULL DEFAULT '{}',
    "status" "AlertStatus" NOT NULL DEFAULT 'open',
    "agent_id" UUID,
    "dedupe_key" TEXT NOT NULL,
    "acknowledged_by" UUID,
    "resolved_by" UUID,
    "resolved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "alerts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "control_mappings" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "control_id" UUID NOT NULL,
    "source" "EvidenceSource" NOT NULL DEFAULT 'missing',
    "evidence_type" TEXT,
    "status" TEXT NOT NULL DEFAULT 'not_assessed',
    "notes" TEXT NOT NULL DEFAULT '',
    "validated_by" UUID,
    "validated_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "control_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "data_classes" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "detector" TEXT NOT NULL,
    "pattern" TEXT,
    "action" "DataAction" NOT NULL DEFAULT 'mask',
    "severity" TEXT NOT NULL DEFAULT 'medium',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "data_classes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "security_events" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "agent_id" UUID,
    "action_request_id" UUID,
    "policy_version_id" UUID,
    "incident_id" UUID,
    "detail" JSONB NOT NULL DEFAULT '{}',
    "status" "SecurityEventStatus" NOT NULL DEFAULT 'open',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "security_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "incidents" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "status" "IncidentStatus" NOT NULL DEFAULT 'open',
    "summary" TEXT NOT NULL DEFAULT '',
    "assignee_id" UUID,
    "agent_ids" UUID[] DEFAULT ARRAY[]::UUID[],
    "resolved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "incidents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "incident_events" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "incident_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "actor_id" UUID,
    "note" TEXT NOT NULL DEFAULT '',
    "security_event_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "incident_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "frameworks" (
    "id" UUID NOT NULL,
    "org_id" UUID,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "version" TEXT NOT NULL DEFAULT '',
    "publisher" TEXT NOT NULL DEFAULT '',
    "license_note" TEXT NOT NULL DEFAULT '',
    "description" TEXT NOT NULL DEFAULT '',
    "is_custom" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "frameworks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "controls" (
    "id" UUID NOT NULL,
    "framework_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL DEFAULT '',
    "category" TEXT NOT NULL DEFAULT '',
    "keywords" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "automated_evidence_type" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "controls_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "documents" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "storage_key" TEXT NOT NULL,
    "status" "DocumentStatus" NOT NULL DEFAULT 'uploaded',
    "error" TEXT,
    "page_count" INTEGER,
    "chunk_count" INTEGER NOT NULL DEFAULT 0,
    "retention_until" TIMESTAMP(3),
    "uploaded_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_chunks" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "document_id" UUID NOT NULL,
    "idx" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "page" INTEGER,
    "tokens" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "document_chunks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assessments" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "framework_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "scope" TEXT NOT NULL DEFAULT '',
    "status" "AssessmentStatus" NOT NULL DEFAULT 'draft',
    "document_ids" UUID[] DEFAULT ARRAY[]::UUID[],
    "summary" JSONB NOT NULL DEFAULT '{}',
    "started_by" UUID,
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "assessments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "findings" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "assessment_id" UUID NOT NULL,
    "control_id" UUID NOT NULL,
    "status" "FindingStatus" NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "rationale" TEXT NOT NULL DEFAULT '',
    "recommendation" TEXT NOT NULL DEFAULT '',
    "human_status" "FindingStatus",
    "validated_by" UUID,
    "validated_at" TIMESTAMP(3),
    "validation_note" TEXT NOT NULL DEFAULT '',
    "resolved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "findings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "evidence_artifacts" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "assessment_id" UUID NOT NULL,
    "finding_id" UUID,
    "kind" "ArtifactKind" NOT NULL,
    "document_id" UUID,
    "chunk_id" UUID,
    "excerpt" TEXT NOT NULL DEFAULT '',
    "score" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "reference" TEXT NOT NULL DEFAULT '',
    "added_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "evidence_artifacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "remediation_tasks" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "finding_id" UUID,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "owner_id" UUID,
    "due_at" TIMESTAMP(3),
    "status" "RemediationStatus" NOT NULL DEFAULT 'open',
    "evidence_document_ids" UUID[] DEFAULT ARRAY[]::UUID[],
    "history" JSONB NOT NULL DEFAULT '[]',
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "remediation_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_exports" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "format" TEXT NOT NULL,
    "storage_key" TEXT NOT NULL,
    "size" INTEGER NOT NULL DEFAULT 0,
    "sha256" TEXT NOT NULL DEFAULT '',
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_exports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL DEFAULT '',
    "link" TEXT,
    "idempotency_key" TEXT NOT NULL,
    "read_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "jobs" (
    "id" UUID NOT NULL,
    "org_id" UUID,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "idempotency_key" TEXT NOT NULL,
    "run_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "max_attempts" INTEGER NOT NULL DEFAULT 5,
    "status" "JobStatus" NOT NULL DEFAULT 'pending',
    "locked_at" TIMESTAMP(3),
    "locked_by" TEXT,
    "last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_events" (
    "id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "actor_id" UUID,
    "org_id" UUID,
    "detail" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deployment_versions" (
    "id" UUID NOT NULL,
    "component" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "git_sha" TEXT NOT NULL DEFAULT '',
    "deployed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "deployment_versions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_token_hash_key" ON "sessions"("token_hash");

-- CreateIndex
CREATE INDEX "sessions_user_id_idx" ON "sessions"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "organizations_slug_key" ON "organizations"("slug");

-- CreateIndex
CREATE INDEX "roles_org_id_idx" ON "roles"("org_id");

-- CreateIndex
CREATE UNIQUE INDEX "roles_org_id_key_key" ON "roles"("org_id", "key");

-- CreateIndex
CREATE INDEX "memberships_org_id_idx" ON "memberships"("org_id");

-- CreateIndex
CREATE INDEX "memberships_user_id_idx" ON "memberships"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "memberships_org_id_user_id_key" ON "memberships"("org_id", "user_id");

-- CreateIndex
CREATE INDEX "teams_org_id_idx" ON "teams"("org_id");

-- CreateIndex
CREATE UNIQUE INDEX "teams_org_id_key_key" ON "teams"("org_id", "key");

-- CreateIndex
CREATE INDEX "team_members_org_id_idx" ON "team_members"("org_id");

-- CreateIndex
CREATE UNIQUE INDEX "team_members_team_id_membership_id_key" ON "team_members"("team_id", "membership_id");

-- CreateIndex
CREATE UNIQUE INDEX "invitations_token_hash_key" ON "invitations"("token_hash");

-- CreateIndex
CREATE INDEX "invitations_org_id_idx" ON "invitations"("org_id");

-- CreateIndex
CREATE UNIQUE INDEX "sso_connections_org_id_key" ON "sso_connections"("org_id");

-- CreateIndex
CREATE UNIQUE INDEX "api_keys_prefix_key" ON "api_keys"("prefix");

-- CreateIndex
CREATE UNIQUE INDEX "api_keys_key_hash_key" ON "api_keys"("key_hash");

-- CreateIndex
CREATE INDEX "api_keys_org_id_idx" ON "api_keys"("org_id");

-- CreateIndex
CREATE INDEX "api_keys_subject_type_subject_id_idx" ON "api_keys"("subject_type", "subject_id");

-- CreateIndex
CREATE INDEX "agents_org_id_status_idx" ON "agents"("org_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "agents_org_id_slug_key" ON "agents"("org_id", "slug");

-- CreateIndex
CREATE INDEX "agent_versions_org_id_idx" ON "agent_versions"("org_id");

-- CreateIndex
CREATE UNIQUE INDEX "agent_versions_agent_id_version_key" ON "agent_versions"("agent_id", "version");

-- CreateIndex
CREATE INDEX "integrations_org_id_idx" ON "integrations"("org_id");

-- CreateIndex
CREATE UNIQUE INDEX "integrations_org_id_key_key" ON "integrations"("org_id", "key");

-- CreateIndex
CREATE INDEX "credentials_org_id_idx" ON "credentials"("org_id");

-- CreateIndex
CREATE UNIQUE INDEX "credentials_integration_id_name_key" ON "credentials"("integration_id", "name");

-- CreateIndex
CREATE INDEX "tools_org_id_idx" ON "tools"("org_id");

-- CreateIndex
CREATE UNIQUE INDEX "tools_org_id_key_key" ON "tools"("org_id", "key");

-- CreateIndex
CREATE INDEX "agent_tools_org_id_idx" ON "agent_tools"("org_id");

-- CreateIndex
CREATE UNIQUE INDEX "agent_tools_agent_id_tool_id_key" ON "agent_tools"("agent_id", "tool_id");

-- CreateIndex
CREATE INDEX "resources_org_id_idx" ON "resources"("org_id");

-- CreateIndex
CREATE UNIQUE INDEX "resources_org_id_key_key" ON "resources"("org_id", "key");

-- CreateIndex
CREATE INDEX "permissions_org_id_idx" ON "permissions"("org_id");

-- CreateIndex
CREATE UNIQUE INDEX "permissions_agent_id_resource_id_key" ON "permissions"("agent_id", "resource_id");

-- CreateIndex
CREATE INDEX "policies_org_id_idx" ON "policies"("org_id");

-- CreateIndex
CREATE UNIQUE INDEX "policies_org_id_key_key" ON "policies"("org_id", "key");

-- CreateIndex
CREATE INDEX "policy_versions_org_id_idx" ON "policy_versions"("org_id");

-- CreateIndex
CREATE UNIQUE INDEX "policy_versions_policy_id_version_key" ON "policy_versions"("policy_id", "version");

-- CreateIndex
CREATE INDEX "policy_assignments_org_id_target_type_target_id_idx" ON "policy_assignments"("org_id", "target_type", "target_id");

-- CreateIndex
CREATE INDEX "policy_events_org_id_policy_id_idx" ON "policy_events"("org_id", "policy_id");

-- CreateIndex
CREATE INDEX "action_requests_org_id_status_idx" ON "action_requests"("org_id", "status");

-- CreateIndex
CREATE INDEX "action_requests_org_id_agent_id_created_at_idx" ON "action_requests"("org_id", "agent_id", "created_at");

-- CreateIndex
CREATE INDEX "action_requests_org_id_created_at_idx" ON "action_requests"("org_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "action_requests_org_id_idempotency_key_key" ON "action_requests"("org_id", "idempotency_key");

-- CreateIndex
CREATE INDEX "authorization_decisions_org_id_created_at_idx" ON "authorization_decisions"("org_id", "created_at");

-- CreateIndex
CREATE INDEX "authorization_decisions_action_request_id_idx" ON "authorization_decisions"("action_request_id");

-- CreateIndex
CREATE INDEX "approval_requests_org_id_status_idx" ON "approval_requests"("org_id", "status");

-- CreateIndex
CREATE INDEX "approval_requests_action_request_id_idx" ON "approval_requests"("action_request_id");

-- CreateIndex
CREATE INDEX "approval_responses_org_id_idx" ON "approval_responses"("org_id");

-- CreateIndex
CREATE INDEX "approval_responses_approval_request_id_idx" ON "approval_responses"("approval_request_id");

-- CreateIndex
CREATE UNIQUE INDEX "execution_grants_token_hash_key" ON "execution_grants"("token_hash");

-- CreateIndex
CREATE INDEX "execution_grants_org_id_idx" ON "execution_grants"("org_id");

-- CreateIndex
CREATE INDEX "execution_receipts_org_id_created_at_idx" ON "execution_receipts"("org_id", "created_at");

-- CreateIndex
CREATE INDEX "evidence_events_org_id_occurred_at_idx" ON "evidence_events"("org_id", "occurred_at");

-- CreateIndex
CREATE INDEX "evidence_events_org_id_type_idx" ON "evidence_events"("org_id", "type");

-- CreateIndex
CREATE INDEX "evidence_events_org_id_correlation_id_idx" ON "evidence_events"("org_id", "correlation_id");

-- CreateIndex
CREATE INDEX "evidence_events_org_id_subject_type_subject_id_idx" ON "evidence_events"("org_id", "subject_type", "subject_id");

-- CreateIndex
CREATE UNIQUE INDEX "evidence_events_org_id_seq_key" ON "evidence_events"("org_id", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "evidence_checkpoints_org_id_through_seq_key" ON "evidence_checkpoints"("org_id", "through_seq");

-- CreateIndex
CREATE INDEX "monitoring_rules_org_id_idx" ON "monitoring_rules"("org_id");

-- CreateIndex
CREATE UNIQUE INDEX "monitoring_rules_org_id_key_key" ON "monitoring_rules"("org_id", "key");

-- CreateIndex
CREATE INDEX "alerts_org_id_status_idx" ON "alerts"("org_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "alerts_org_id_dedupe_key_key" ON "alerts"("org_id", "dedupe_key");

-- CreateIndex
CREATE UNIQUE INDEX "control_mappings_org_id_control_id_key" ON "control_mappings"("org_id", "control_id");

-- CreateIndex
CREATE UNIQUE INDEX "data_classes_org_id_key_key" ON "data_classes"("org_id", "key");

-- CreateIndex
CREATE INDEX "security_events_org_id_created_at_idx" ON "security_events"("org_id", "created_at");

-- CreateIndex
CREATE INDEX "security_events_org_id_severity_status_idx" ON "security_events"("org_id", "severity", "status");

-- CreateIndex
CREATE INDEX "incidents_org_id_status_idx" ON "incidents"("org_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "incidents_org_id_number_key" ON "incidents"("org_id", "number");

-- CreateIndex
CREATE INDEX "incident_events_incident_id_idx" ON "incident_events"("incident_id");

-- CreateIndex
CREATE UNIQUE INDEX "frameworks_key_org_id_key" ON "frameworks"("key", "org_id");

-- CreateIndex
CREATE UNIQUE INDEX "controls_framework_id_code_key" ON "controls"("framework_id", "code");

-- CreateIndex
CREATE INDEX "documents_org_id_idx" ON "documents"("org_id");

-- CreateIndex
CREATE INDEX "document_chunks_org_id_idx" ON "document_chunks"("org_id");

-- CreateIndex
CREATE UNIQUE INDEX "document_chunks_document_id_idx_key" ON "document_chunks"("document_id", "idx");

-- CreateIndex
CREATE INDEX "assessments_org_id_idx" ON "assessments"("org_id");

-- CreateIndex
CREATE INDEX "findings_org_id_idx" ON "findings"("org_id");

-- CreateIndex
CREATE UNIQUE INDEX "findings_assessment_id_control_id_key" ON "findings"("assessment_id", "control_id");

-- CreateIndex
CREATE INDEX "evidence_artifacts_org_id_idx" ON "evidence_artifacts"("org_id");

-- CreateIndex
CREATE INDEX "remediation_tasks_org_id_status_idx" ON "remediation_tasks"("org_id", "status");

-- CreateIndex
CREATE INDEX "audit_exports_org_id_idx" ON "audit_exports"("org_id");

-- CreateIndex
CREATE INDEX "notifications_org_id_user_id_read_at_idx" ON "notifications"("org_id", "user_id", "read_at");

-- CreateIndex
CREATE UNIQUE INDEX "notifications_org_id_idempotency_key_key" ON "notifications"("org_id", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "jobs_idempotency_key_key" ON "jobs"("idempotency_key");

-- CreateIndex
CREATE INDEX "jobs_status_run_at_idx" ON "jobs"("status", "run_at");

-- CreateIndex
CREATE INDEX "platform_events_created_at_idx" ON "platform_events"("created_at");

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_versions" ADD CONSTRAINT "agent_versions_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credentials" ADD CONSTRAINT "credentials_integration_id_fkey" FOREIGN KEY ("integration_id") REFERENCES "integrations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tools" ADD CONSTRAINT "tools_integration_id_fkey" FOREIGN KEY ("integration_id") REFERENCES "integrations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_tools" ADD CONSTRAINT "agent_tools_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_tools" ADD CONSTRAINT "agent_tools_tool_id_fkey" FOREIGN KEY ("tool_id") REFERENCES "tools"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "permissions" ADD CONSTRAINT "permissions_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "permissions" ADD CONSTRAINT "permissions_resource_id_fkey" FOREIGN KEY ("resource_id") REFERENCES "resources"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "policy_versions" ADD CONSTRAINT "policy_versions_policy_id_fkey" FOREIGN KEY ("policy_id") REFERENCES "policies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "policy_assignments" ADD CONSTRAINT "policy_assignments_policy_id_fkey" FOREIGN KEY ("policy_id") REFERENCES "policies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "policy_events" ADD CONSTRAINT "policy_events_policy_id_fkey" FOREIGN KEY ("policy_id") REFERENCES "policies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "action_requests" ADD CONSTRAINT "action_requests_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "authorization_decisions" ADD CONSTRAINT "authorization_decisions_action_request_id_fkey" FOREIGN KEY ("action_request_id") REFERENCES "action_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_action_request_id_fkey" FOREIGN KEY ("action_request_id") REFERENCES "action_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_responses" ADD CONSTRAINT "approval_responses_approval_request_id_fkey" FOREIGN KEY ("approval_request_id") REFERENCES "approval_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "execution_grants" ADD CONSTRAINT "execution_grants_action_request_id_fkey" FOREIGN KEY ("action_request_id") REFERENCES "action_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "execution_receipts" ADD CONSTRAINT "execution_receipts_action_request_id_fkey" FOREIGN KEY ("action_request_id") REFERENCES "action_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_rule_id_fkey" FOREIGN KEY ("rule_id") REFERENCES "monitoring_rules"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "control_mappings" ADD CONSTRAINT "control_mappings_control_id_fkey" FOREIGN KEY ("control_id") REFERENCES "controls"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "security_events" ADD CONSTRAINT "security_events_incident_id_fkey" FOREIGN KEY ("incident_id") REFERENCES "incidents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incident_events" ADD CONSTRAINT "incident_events_incident_id_fkey" FOREIGN KEY ("incident_id") REFERENCES "incidents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "controls" ADD CONSTRAINT "controls_framework_id_fkey" FOREIGN KEY ("framework_id") REFERENCES "frameworks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_chunks" ADD CONSTRAINT "document_chunks_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessments" ADD CONSTRAINT "assessments_framework_id_fkey" FOREIGN KEY ("framework_id") REFERENCES "frameworks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "findings" ADD CONSTRAINT "findings_assessment_id_fkey" FOREIGN KEY ("assessment_id") REFERENCES "assessments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "findings" ADD CONSTRAINT "findings_control_id_fkey" FOREIGN KEY ("control_id") REFERENCES "controls"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evidence_artifacts" ADD CONSTRAINT "evidence_artifacts_assessment_id_fkey" FOREIGN KEY ("assessment_id") REFERENCES "assessments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evidence_artifacts" ADD CONSTRAINT "evidence_artifacts_finding_id_fkey" FOREIGN KEY ("finding_id") REFERENCES "findings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "remediation_tasks" ADD CONSTRAINT "remediation_tasks_finding_id_fkey" FOREIGN KEY ("finding_id") REFERENCES "findings"("id") ON DELETE SET NULL ON UPDATE CASCADE;
