import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { disconnectAll, withTenant } from "@aegis/db";
import { makeTestTenant, type TestTenant } from "./helpers.js";
import { loadDeploymentManifest, manifestSchema, type DeploymentManifest } from "../src/deployment/manifest.js";
import { assessResidency } from "../src/deployment/residency.js";
import { APPEND_ONLY_TABLES, deploymentReadiness, evaluateReadiness, type ReadinessProbes } from "../src/deployment/readiness.js";

const NOW = new Date("2026-10-14T08:00:00Z");
const recent = new Date("2026-08-01T00:00:00Z");

function uaeManifest(over: Partial<DeploymentManifest> = {}): DeploymentManifest {
  return manifestSchema.parse({
    model: "single_tenant_managed",
    operator: "Example operator",
    components: [
      { key: "hosting", kind: "hosting", provider: "Example cloud", region: "uae-north", country: "AE", attestedBy: "Ops lead", attestedAt: recent },
      { key: "db", kind: "database", provider: "Managed PostgreSQL", region: "uae-north", country: "AE", encryptionAtRest: "customer_managed_keys", attestedBy: "Ops lead", attestedAt: recent },
      { key: "email", kind: "email", provider: "Mail relay", country: "AE", subprocessor: true, attestedBy: "Ops lead", attestedAt: recent },
      { key: "metrics", kind: "monitoring", provider: "Metrics SaaS", country: "US", holdsCustomerData: false },
    ],
    backups: { schedule: "Daily snapshots", retentionDays: 35, country: "AE", encrypted: true, lastRestoreTestAt: recent },
    ...over,
  });
}

describe("data residency (pure)", () => {
  it("allows a claim only when every customer-data component and the backups are attested in the country", () => {
    const a = assessResidency(uaeManifest(), "AE", NOW);
    expect(a.claimAllowed).toBe(true);
    expect(a.components.find((c) => c.key === "metrics")!.status).toBe("no_customer_data");
    expect(a.statement).toContain("not an independent audit");
  });

  it("refuses the claim for a subprocessor outside the country, an undeclared country, a stale attestation or offshore backups", () => {
    const base = uaeManifest();
    const cases: DeploymentManifest[] = [
      { ...base, components: base.components.map((c) => (c.key === "email" ? { ...c, country: "IE" } : c)) },
      { ...base, components: base.components.map((c) => (c.key === "db" ? { ...c, country: "unknown" } : c)) },
      { ...base, components: base.components.map((c) => (c.key === "hosting" ? { ...c, attestedAt: new Date("2025-01-01") } : c)) },
      { ...base, backups: { ...base.backups!, country: "DE" } },
      { ...base, backups: undefined },
      { ...base, components: base.components.filter((c) => c.kind !== "database") },
    ];
    for (const m of cases) {
      const a = assessResidency(m, "AE", NOW);
      expect(a.claimAllowed).toBe(false);
      expect(a.statement).toMatch(/^AEGIS makes no AE data residency claim/);
      expect(a.blockers.length).toBeGreaterThan(0);
    }
  });

  it("never claims residency for a development installation or without a manifest", () => {
    expect(assessResidency(uaeManifest({ model: "development" }), "AE", NOW).claimAllowed).toBe(false);
    const none = loadDeploymentManifest(undefined);
    expect(none.source).toBe("none");
    expect(assessResidency(none.manifest, "AE", NOW).claimAllowed).toBe(false);
  });

  it("reports an invalid manifest instead of silently using it", () => {
    const bad = loadDeploymentManifest(JSON.stringify({ model: "cloud", components: [] }));
    expect(bad.error).toBeTruthy();
    expect(loadDeploymentManifest("{not json").error).toMatch(/not valid JSON/);
    expect(loadDeploymentManifest("/no/such/file.json").error).toMatch(/not found/);
    expect(loadDeploymentManifest(JSON.stringify(uaeManifest())).manifest.model).toBe("single_tenant_managed");
  });
});

function probes(over: Partial<ReadinessProbes> = {}): ReadinessProbes {
  return {
    production: true,
    webUrl: "https://aegis.example",
    apiUrl: "https://api.aegis.example",
    databaseUrlHost: "db.internal",
    databaseSsl: true,
    redisUrl: "rediss://cache.internal:6380",
    masterKeyBytes: 32,
    evidenceSigningKey: true,
    otelEndpoint: true,
    role: { name: "aegis_app", superuser: false, bypassRls: false },
    orgTables: [{ table: "agents", rls: true, ownedByApp: false }],
    appendOnlyTriggers: [...APPEND_ONLY_TABLES],
    plaintextSecrets: 0,
    storedSecrets: 3,
    auditRetentionDays: 2555,
    requireMfa: true,
    admins: { total: 1, withoutMfa: 0 },
    platformAdmins: 1,
    now: NOW,
    ...over,
  };
}

describe("deployment readiness (pure)", () => {
  const status = (checks: ReturnType<typeof evaluateReadiness>, key: string) => checks.find((c) => c.key === key)!.status;

  it("a well configured production installation passes every check", () => {
    const checks = evaluateReadiness(uaeManifest({ secrets: { source: "cloud_kms", rotationDays: 90 }, disasterRecovery: { rpoMinutes: 15, rtoMinutes: 240, lastExerciseAt: recent, runbook: "docs/BACKUP_RECOVERY.md" } }), probes());
    expect(checks.filter((c) => c.status !== "ok").map((c) => `${c.key}: ${c.detail}`)).toEqual([]);
  });

  it("fails plain HTTP, an unencrypted remote database, a superuser role, missing RLS and plaintext secrets in production", () => {
    const checks = evaluateReadiness(uaeManifest(), probes({ webUrl: "http://aegis.example", databaseSsl: false, role: { name: "postgres", superuser: true, bypassRls: true }, orgTables: [{ table: "agents", rls: false, ownedByApp: false }], plaintextSecrets: 1, redisUrl: "redis://cache.internal:6379" }));
    for (const k of ["tls_public", "tls_database", "app_role", "rls", "secrets_sealed", "tls_redis"]) expect(status(checks, k)).toBe("failing");
  });

  it("an application role that owns tables fails isolation, and missing append-only triggers fail retention", () => {
    const checks = evaluateReadiness(uaeManifest(), probes({ orgTables: [{ table: "agents", rls: true, ownedByApp: true }], appendOnlyTriggers: ["evidence_events"] }));
    expect(status(checks, "rls")).toBe("failing");
    expect(status(checks, "append_only")).toBe("failing");
  });

  it("declared facts that are absent show as unknown, never as ok", () => {
    const checks = evaluateReadiness(manifestSchema.parse({ model: "customer_private" }), probes());
    for (const k of ["storage_encryption", "secret_store", "backups", "disaster_recovery"]) {
      expect(status(checks, k)).toBe("unknown");
      expect(checks.find((c) => c.key === k)!.basis).toBe("declared");
    }
  });

  it("a stale restore test and an admin without two-factor authentication are warnings", () => {
    const old = uaeManifest({ backups: { schedule: "Daily", retentionDays: 30, country: "AE", encrypted: true, lastRestoreTestAt: new Date("2026-01-01") } });
    const checks = evaluateReadiness(old, probes({ requireMfa: false, admins: { total: 2, withoutMfa: 1 } }));
    expect(status(checks, "backups")).toBe("warning");
    expect(status(checks, "admin_mfa")).toBe("warning");
  });
});

describe("deployment readiness (live database)", () => {
  let t: TestTenant;
  beforeAll(async () => {
    t = await makeTestTenant("deploy");
  }, 60_000);
  afterAll(async () => {
    await t.cleanup();
    await disconnectAll();
  });

  it("measures the application role, row-level security and append-only triggers on the real database", async () => {
    const r = await withTenant(t.orgId, (db) => deploymentReadiness(db, t.ownerCtx, { settings: {}, loaded: { manifest: uaeManifest(), source: "environment" } }));
    const by = new Map(r.checks.map((c) => [c.key, c]));
    expect(by.get("app_role")!.status).toBe("ok");
    expect(by.get("app_role")!.basis).toBe("live");
    expect(by.get("rls")!.status).toBe("ok");
    expect(by.get("rls")!.detail).toMatch(/Enabled on all \d+ tables/);
    expect(by.get("append_only")!.status).toBe("ok");
    expect(by.get("secrets_sealed")!.status).toBe("ok");
    expect(r.auditRetentionDays).toBe(2555);
    expect(r.residency.country).toBe("AE");
  });
});

describe("example manifests in deploy/profiles", () => {
  it("all validate, and none produces a residency claim before an operator attests it", async () => {
    const { readdirSync } = await import("node:fs");
    const { join } = await import("node:path");
    const dir = join(__dirname, "..", "..", "..", "deploy", "profiles");
    const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
    expect(files.length).toBe(4);
    for (const f of files) {
      const loaded = loadDeploymentManifest(join(dir, f));
      expect(loaded.error, f).toBeUndefined();
      expect(assessResidency(loaded.manifest, "AE", NOW).claimAllowed, f).toBe(false);
    }
  });
});
