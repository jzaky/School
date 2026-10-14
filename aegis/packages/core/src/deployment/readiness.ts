import type { TenantDb } from "@aegis/db";
import { env } from "../env.js";
import { hasPermission, type Permission } from "../identity/permissions.js";
import type { OrgContext } from "../lib/context.js";
import { assertPermission } from "../orgs/orgs.js";
import { assessResidency, type ResidencyAssessment } from "./residency.js";
import { loadDeploymentManifest, MODEL_TEXT, type DeploymentManifest, type LoadedManifest } from "./manifest.js";

/**
 * Deployment readiness (docs/DEPLOYMENT_OPTIONS.md). Each check says how it was established:
 * - live: AEGIS measured it just now (database connection TLS, row-level security, triggers, stored secrets);
 * - configuration: read from this process's settings (URLs, keys);
 * - declared: taken from the operator's deployment manifest, which AEGIS cannot verify from inside.
 */

export type ReadinessStatus = "ok" | "warning" | "failing" | "unknown";
export type ReadinessBasis = "live" | "configuration" | "declared";
export type ReadinessArea = "encryption_in_transit" | "encryption_at_rest" | "secrets" | "tenant_isolation" | "audit_retention" | "backup_recovery" | "monitoring" | "admin_access";

export const AREA_TEXT: Record<ReadinessArea, string> = {
  encryption_in_transit: "Encryption in transit",
  encryption_at_rest: "Encryption at rest",
  secrets: "Secrets management",
  tenant_isolation: "Tenant isolation",
  audit_retention: "Audit retention",
  backup_recovery: "Backup and disaster recovery",
  monitoring: "Deployment health monitoring",
  admin_access: "Administrative access",
};

export interface ReadinessCheck {
  key: string;
  area: ReadinessArea;
  label: string;
  status: ReadinessStatus;
  basis: ReadinessBasis;
  detail: string;
}

export const APPEND_ONLY_TABLES = ["evidence_events", "evidence_checkpoints", "authorization_decisions", "approval_responses", "execution_receipts", "policy_events", "autonomy_transitions"] as const;
export const MIN_AUDIT_RETENTION_DAYS = 365;
export const DEFAULT_AUDIT_RETENTION_DAYS = 2555;

/** What the live probes found. Kept separate so the evaluation below is a pure, tested function. */
export interface ReadinessProbes {
  production: boolean;
  webUrl: string;
  apiUrl: string;
  databaseUrlHost: string;
  databaseSsl: boolean | null;
  redisUrl: string | null;
  masterKeyBytes: number;
  evidenceSigningKey: boolean;
  otelEndpoint: boolean;
  role: { name: string; superuser: boolean; bypassRls: boolean } | null;
  orgTables: { table: string; rls: boolean; ownedByApp: boolean }[];
  appendOnlyTriggers: string[];
  plaintextSecrets: number;
  storedSecrets: number;
  auditRetentionDays: number;
  requireMfa: boolean;
  admins: { total: number; withoutMfa: number };
  platformAdmins: number;
  now: Date;
}

const LOOPBACK = /^(localhost|127\.\d+\.\d+\.\d+|::1|\[::1\]|)$/;

function host(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

const days = (a: Date, b: Date) => Math.floor((a.getTime() - b.getTime()) / 86_400_000);

export function evaluateReadiness(m: DeploymentManifest, p: ReadinessProbes): ReadinessCheck[] {
  const out: ReadinessCheck[] = [];
  const add = (c: ReadinessCheck) => out.push(c);

  // Encryption in transit.
  const insecure = [p.webUrl, p.apiUrl].filter((u) => !u.startsWith("https://"));
  add({ key: "tls_public", area: "encryption_in_transit", label: "Browser and API traffic", basis: "configuration", status: insecure.length === 0 ? "ok" : p.production ? "failing" : "warning", detail: insecure.length === 0 ? "Public web and API addresses use HTTPS" : `Not HTTPS: ${insecure.join(", ")}${p.production ? "" : " (acceptable only for local development)"}` });
  const dbLoopback = LOOPBACK.test(p.databaseUrlHost) || p.databaseUrlHost.startsWith("/");
  add({ key: "tls_database", area: "encryption_in_transit", label: "Database connection", basis: "live", status: p.databaseSsl === null ? "unknown" : p.databaseSsl ? "ok" : dbLoopback ? "warning" : "failing", detail: p.databaseSsl === null ? "Could not read the connection's TLS state" : p.databaseSsl ? "This connection is encrypted with TLS (checked on the database server)" : dbLoopback ? "This connection is not encrypted; the database is on the same host" : "This connection to a separate database host is not encrypted: add sslmode=verify-full to DATABASE_URL" });
  if (!p.redisUrl) add({ key: "tls_redis", area: "encryption_in_transit", label: "Queue connection (Redis)", basis: "configuration", status: "unknown", detail: "REDIS_URL is not set in this process" });
  else {
    const tls = p.redisUrl.startsWith("rediss://");
    const lo = LOOPBACK.test(host(p.redisUrl));
    add({ key: "tls_redis", area: "encryption_in_transit", label: "Queue connection (Redis)", basis: "configuration", status: tls ? "ok" : lo ? "warning" : "failing", detail: tls ? "Uses TLS (rediss://)" : lo ? "Not encrypted; Redis is on the same host" : "Not encrypted: use a rediss:// address" });
  }

  // Encryption at rest.
  add({ key: "secrets_sealed", area: "encryption_at_rest", label: "Stored credentials and webhook secrets", basis: "live", status: p.plaintextSecrets > 0 ? "failing" : "ok", detail: p.plaintextSecrets > 0 ? `${p.plaintextSecrets} stored secret${p.plaintextSecrets === 1 ? " is" : "s are"} not in the AES-256-GCM envelope` : `All ${p.storedSecrets} stored secrets of this organization are sealed with AES-256-GCM, bound to their record` });
  const db = m.components.find((c) => c.kind === "database");
  add({ key: "storage_encryption", area: "encryption_at_rest", label: "Database and backup storage", basis: "declared", status: !db || db.encryptionAtRest === "unknown" ? "unknown" : db.encryptionAtRest === "none" ? "failing" : "ok", detail: !db ? "No database declared in the deployment manifest" : db.encryptionAtRest === "unknown" ? "Not declared in the deployment manifest" : db.encryptionAtRest === "none" ? "Declared as not encrypted at rest" : `Declared: ${db.encryptionAtRest === "customer_managed_keys" ? "encrypted with customer-managed keys" : "encrypted by the provider"} (${db.provider})` });

  // Secrets management.
  add({ key: "master_key", area: "secrets", label: "Master encryption key", basis: "configuration", status: p.masterKeyBytes === 32 ? "ok" : "failing", detail: p.masterKeyBytes === 32 ? "Present and 256 bits; the value is never displayed" : "AEGIS_MASTER_KEY does not decode to 32 bytes" });
  add({ key: "evidence_key", area: "secrets", label: "Evidence signing key", basis: "configuration", status: p.evidenceSigningKey ? "ok" : p.production ? "failing" : "warning", detail: p.evidenceSigningKey ? "Present; checkpoints are signed" : "EVIDENCE_SIGNING_KEY is not set, so checkpoints cannot be signed" });
  add({ key: "secret_store", area: "secrets", label: "Where secrets are kept", basis: "declared", status: !m.secrets ? "unknown" : m.secrets.source === "environment" && p.production ? "warning" : "ok", detail: !m.secrets ? "Not declared in the deployment manifest" : `${({ environment: "Process environment", kubernetes_secret: "Kubernetes secrets", vault: "HashiCorp Vault or compatible", cloud_kms: "Cloud key management service", hsm: "Hardware security module" } as const)[m.secrets.source]}${m.secrets.rotationDays ? `, rotated every ${m.secrets.rotationDays} days` : ", no rotation period declared"}` });

  // Tenant isolation.
  const roleOk = !!p.role && !p.role.superuser && !p.role.bypassRls;
  add({ key: "app_role", area: "tenant_isolation", label: "Application database role", basis: "live", status: !p.role ? "unknown" : roleOk ? "ok" : "failing", detail: !p.role ? "Could not read the role" : roleOk ? `Connected as ${p.role.name}: not a superuser and cannot bypass row-level security` : `Connected as ${p.role.name}, which ${p.role.superuser ? "is a superuser" : "can bypass row-level security"}: isolation is not enforced` });
  const noRls = p.orgTables.filter((t) => !t.rls).map((t) => t.table);
  const owned = p.orgTables.filter((t) => t.ownedByApp).map((t) => t.table);
  add({ key: "rls", area: "tenant_isolation", label: "Row-level security on organization tables", basis: "live", status: p.orgTables.length === 0 ? "unknown" : noRls.length || owned.length ? "failing" : "ok", detail: p.orgTables.length === 0 ? "No organization tables found" : noRls.length ? `Not enabled on: ${noRls.slice(0, 6).join(", ")}${noRls.length > 6 ? ` and ${noRls.length - 6} more` : ""}` : owned.length ? `Owned by the application role (policies do not apply to owners): ${owned.slice(0, 6).join(", ")}` : `Enabled on all ${p.orgTables.length} tables that carry an organization id, none owned by the application role` });

  // Audit retention.
  const missing = APPEND_ONLY_TABLES.filter((t) => !p.appendOnlyTriggers.includes(t));
  add({ key: "append_only", area: "audit_retention", label: "Audit records cannot be changed or deleted", basis: "live", status: missing.length ? "failing" : "ok", detail: missing.length ? `No append-only trigger on: ${missing.join(", ")}` : `Append-only triggers present on ${APPEND_ONLY_TABLES.length} audit tables; AEGIS never deletes them` });
  add({ key: "retention_period", area: "audit_retention", label: "Retention period", basis: "configuration", status: p.auditRetentionDays >= MIN_AUDIT_RETENTION_DAYS ? "ok" : "warning", detail: `${p.auditRetentionDays} days (about ${(p.auditRetentionDays / 365).toFixed(1)} years). Records are kept at least this long; archive with evidence exports before any database is decommissioned.` });

  // Backup and disaster recovery.
  const b = m.backups;
  add({ key: "backups", area: "backup_recovery", label: "Backups", basis: "declared", status: !b ? "unknown" : !b.encrypted ? "warning" : !b.lastRestoreTestAt ? "warning" : days(p.now, b.lastRestoreTestAt) > 90 ? "warning" : "ok", detail: !b ? "No backup arrangement declared" : `${b.schedule}, kept ${b.retentionDays} days${b.encrypted ? ", encrypted" : ", not declared as encrypted"}; ${b.lastRestoreTestAt ? `last restore test ${days(p.now, b.lastRestoreTestAt)} days ago${days(p.now, b.lastRestoreTestAt) > 90 ? " (over 90 days)" : ""}` : "no restore test recorded"}` });
  const dr = m.disasterRecovery;
  add({ key: "disaster_recovery", area: "backup_recovery", label: "Disaster recovery", basis: "declared", status: !dr ? "unknown" : !dr.lastExerciseAt || days(p.now, dr.lastExerciseAt) > 365 ? "warning" : "ok", detail: !dr ? "No recovery objectives declared" : `Recovery point ${dr.rpoMinutes} minutes, recovery time ${dr.rtoMinutes} minutes${dr.secondaryCountry ? `, secondary site in ${dr.secondaryCountry}` : ""}; ${dr.lastExerciseAt ? `last exercise ${days(p.now, dr.lastExerciseAt)} days ago` : "never exercised"}. Runbook: ${dr.runbook}` });

  // Monitoring.
  add({ key: "telemetry", area: "monitoring", label: "Telemetry export", basis: "configuration", status: p.otelEndpoint ? "ok" : p.production ? "warning" : "unknown", detail: p.otelEndpoint ? "OpenTelemetry traces are exported to the configured collector" : "OTEL_EXPORTER_OTLP_ENDPOINT is not set; System Health in the console still works" });

  // Administrative access.
  add({ key: "admin_mfa", area: "admin_access", label: "Two-factor authentication for administrators", basis: "live", status: p.requireMfa ? "ok" : p.admins.withoutMfa > 0 ? "warning" : "ok", detail: `${p.requireMfa ? "Required for everyone in this organization" : "Not required by the organization"}; ${p.admins.withoutMfa} of ${p.admins.total} people with org:admin have not turned it on` });
  add({ key: "platform_admins", area: "admin_access", label: "Platform administrators", basis: "live", status: p.platformAdmins <= 3 ? "ok" : "warning", detail: `${p.platformAdmins} account${p.platformAdmins === 1 ? "" : "s"} can administer the whole installation${p.platformAdmins > 3 ? "; keep this small" : ""}` });
  return out;
}

export interface DeploymentReport {
  loaded: LoadedManifest;
  model: (typeof MODEL_TEXT)[keyof typeof MODEL_TEXT] & { key: DeploymentManifest["model"] };
  residency: ResidencyAssessment;
  checks: ReadinessCheck[];
  auditRetentionDays: number;
  generatedAt: Date;
}

function readRetention(settings: Record<string, unknown>): number {
  const v = settings.auditRetentionDays;
  return typeof v === "number" && Number.isInteger(v) && v > 0 ? v : DEFAULT_AUDIT_RETENTION_DAYS;
}

export async function deploymentReadiness(db: TenantDb, ctx: OrgContext, opts: { settings: Record<string, unknown>; loaded?: LoadedManifest }): Promise<DeploymentReport> {
  assertPermission(ctx, "org:read");
  const now = ctx.now ?? new Date();
  const loaded = opts.loaded ?? loadDeploymentManifest();
  const e = env();
  const [ssl, role, tables, triggers, secretRows, members, platformAdmins] = await Promise.all([
    db.$queryRaw<{ ssl: boolean }[]>`SELECT ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid()`.catch(() => []),
    db.$queryRaw<{ name: string; superuser: boolean; bypass: boolean }[]>`SELECT rolname AS name, rolsuper AS superuser, rolbypassrls AS bypass FROM pg_roles WHERE rolname = current_user`.catch(() => []),
    db.$queryRaw<{ table: string; rls: boolean; owned: boolean }[]>`
      SELECT c.relname AS table, c.relrowsecurity AS rls, pg_get_userbyid(c.relowner) = current_user AS owned
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
        AND EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attname = 'org_id' AND NOT a.attisdropped)
      ORDER BY c.relname`.catch(() => []),
    db.$queryRaw<{ table: string }[]>`SELECT DISTINCT c.relname AS table FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid WHERE t.tgname = 'forbid_mutation' AND NOT t.tgisinternal AND t.tgenabled <> 'D'`.catch(() => []),
    Promise.all([
      db.integration.findMany({ where: { orgId: ctx.orgId, webhookSecretEnc: { not: null } }, select: { webhookSecretEnc: true } }),
      db.credential.findMany({ where: { orgId: ctx.orgId }, select: { secretEnc: true } }),
      db.eventDestination.findMany({ where: { orgId: ctx.orgId }, select: { secretEnvelope: true } }),
      db.ssoConnection.findMany({ where: { orgId: ctx.orgId }, select: { clientSecretEnc: true } }),
    ]),
    db.membership.findMany({ where: { orgId: ctx.orgId, status: "active" }, select: { role: { select: { permissions: true } }, user: { select: { mfaEnabled: true } } } }),
    db.user.count({ where: { isPlatformAdmin: true } }),
  ]);
  const secrets = [...secretRows[0].map((r) => r.webhookSecretEnc ?? ""), ...secretRows[1].map((r) => r.secretEnc), ...secretRows[2].map((r) => r.secretEnvelope), ...secretRows[3].map((r) => r.clientSecretEnc)].filter((s) => s !== "" && s !== "pending");
  const admins = members.filter((m) => hasPermission(m.role.permissions as Permission[], "org:admin"));
  const auditRetentionDays = readRetention(opts.settings);
  const probes: ReadinessProbes = {
    production: e.NODE_ENV === "production",
    webUrl: e.WEB_PUBLIC_URL,
    apiUrl: e.API_PUBLIC_URL,
    databaseUrlHost: host(e.DATABASE_URL),
    databaseSsl: ssl[0] ? !!ssl[0].ssl : null,
    redisUrl: e.REDIS_URL ?? null,
    masterKeyBytes: Buffer.from(e.AEGIS_MASTER_KEY, "base64").length,
    evidenceSigningKey: !!e.EVIDENCE_SIGNING_KEY,
    otelEndpoint: !!e.OTEL_EXPORTER_OTLP_ENDPOINT,
    role: role[0] ? { name: role[0].name, superuser: role[0].superuser, bypassRls: role[0].bypass } : null,
    orgTables: tables.map((t) => ({ table: t.table, rls: t.rls, ownedByApp: t.owned })),
    appendOnlyTriggers: triggers.map((t) => t.table),
    plaintextSecrets: secrets.filter((s) => !/^v1\.[\w-]+\.[\w-]+\.[\w-]+$/.test(s)).length,
    storedSecrets: secrets.length,
    auditRetentionDays,
    requireMfa: opts.settings.requireMfa === true,
    admins: { total: admins.length, withoutMfa: admins.filter((a) => !a.user.mfaEnabled).length },
    platformAdmins,
    now,
  };
  const country = typeof opts.settings.dataResidencyCountry === "string" && /^[A-Z]{2}$/.test(opts.settings.dataResidencyCountry) ? opts.settings.dataResidencyCountry : "AE";
  return {
    loaded,
    model: { key: loaded.manifest.model, ...MODEL_TEXT[loaded.manifest.model] },
    residency: assessResidency(loaded.manifest, country, now),
    checks: evaluateReadiness(loaded.manifest, probes),
    auditRetentionDays,
    generatedAt: now,
  };
}
