import { existsSync, readFileSync } from "node:fs";
import { z } from "zod";

/**
 * The deployment manifest (docs/DEPLOYMENT_OPTIONS.md) is the operator's written statement of where each
 * part of a deployment runs and who runs it. AEGIS cannot see the hosting provider's data centres, so
 * these facts are declared, attested by a named person with a date, and shown as declared. Facts AEGIS
 * can check from inside (database TLS, row-level security, append-only triggers, keys) are checked live
 * by readiness.ts instead of being taken from here.
 */

export const DEPLOYMENT_MODELS = ["multi_tenant_saas", "single_tenant_managed", "customer_private", "on_premises", "development"] as const;
export type DeploymentModel = (typeof DEPLOYMENT_MODELS)[number];

export const MODEL_TEXT: Record<DeploymentModel, { name: string; summary: string; operator: string; isolation: string }> = {
  multi_tenant_saas: { name: "Multi-tenant SaaS", summary: "One AEGIS installation shared by many organizations, operated by the AEGIS provider.", operator: "AEGIS provider", isolation: "Row-level security per organization in one database, a non-owner application role, per-organization encryption keys for secrets" },
  single_tenant_managed: { name: "Single-tenant managed", summary: "A dedicated installation (own database, cache, storage and keys) for one customer, operated by the AEGIS provider.", operator: "AEGIS provider", isolation: "Dedicated infrastructure; row-level security still applies inside it" },
  customer_private: { name: "Customer-controlled private cloud", summary: "Installed in the customer's own cloud account with the Kubernetes manifests or Docker Compose file; the customer holds the keys and the infrastructure.", operator: "Customer", isolation: "Customer's own account and network; row-level security still applies inside it" },
  on_premises: { name: "On-premises", summary: "Installed on the customer's own servers with Docker Compose or systemd units. Needs PostgreSQL 16 and Redis 7; runs without internet access except for integrations the customer enables.", operator: "Customer", isolation: "Customer's own hardware and network; row-level security still applies inside it" },
  development: { name: "Development", summary: "A local or test installation. Not for customer data.", operator: "Developer", isolation: "Row-level security as in production" },
};

const COUNTRY = z.string().regex(/^([A-Z]{2}|unknown)$/, "ISO 3166 alpha-2 country code, or unknown");

export const componentSchema = z.object({
  key: z.string().min(1).max(60),
  kind: z.enum(["hosting", "database", "cache", "object_storage", "backup", "email", "ai_model", "logging", "monitoring", "other"]),
  /** What it is, for example "Managed PostgreSQL" or "Resend". */
  provider: z.string().min(1).max(120),
  /** Provider region name as the provider writes it, for example "me-central-1". */
  region: z.string().max(80).default(""),
  country: COUNTRY.default("unknown"),
  /** Whether customer data (as opposed to only operational metadata) passes through or rests here. */
  holdsCustomerData: z.boolean().default(true),
  encryptionAtRest: z.enum(["customer_managed_keys", "provider_managed", "none", "unknown", "not_applicable"]).default("unknown"),
  /** A subprocessor is a third party that processes customer data on the operator's behalf. */
  subprocessor: z.boolean().default(false),
  attestedBy: z.string().max(120).optional(),
  attestedAt: z.coerce.date().optional(),
  notes: z.string().max(500).optional(),
});
export type DeploymentComponent = z.infer<typeof componentSchema>;

export const manifestSchema = z.object({
  model: z.enum(DEPLOYMENT_MODELS),
  name: z.string().max(120).default("AEGIS"),
  operator: z.string().max(120).default(""),
  components: z.array(componentSchema).max(50).default([]),
  backups: z
    .object({
      schedule: z.string().max(120),
      retentionDays: z.number().int().min(1).max(36500),
      country: COUNTRY.default("unknown"),
      encrypted: z.boolean().default(false),
      lastRestoreTestAt: z.coerce.date().optional(),
    })
    .optional(),
  disasterRecovery: z
    .object({
      rpoMinutes: z.number().int().min(0).max(100000),
      rtoMinutes: z.number().int().min(0).max(100000),
      secondaryCountry: COUNTRY.optional(),
      lastExerciseAt: z.coerce.date().optional(),
      runbook: z.string().max(200).default("docs/BACKUP_RECOVERY.md"),
    })
    .optional(),
  secrets: z.object({ source: z.enum(["environment", "kubernetes_secret", "vault", "cloud_kms", "hsm"]), rotationDays: z.number().int().min(1).max(3650).optional() }).optional(),
});
export type DeploymentManifest = z.infer<typeof manifestSchema>;

export const DEVELOPMENT_MANIFEST: DeploymentManifest = { model: "development", name: "AEGIS", operator: "", components: [] };

export interface LoadedManifest {
  manifest: DeploymentManifest;
  source: "environment" | "file" | "none";
  error?: string;
}

/**
 * Reads AEGIS_DEPLOYMENT_MANIFEST: inline JSON or a path to a JSON file. Missing means "not declared",
 * never "compliant". A manifest that does not validate is reported, not silently replaced.
 */
export function loadDeploymentManifest(raw = process.env.AEGIS_DEPLOYMENT_MANIFEST): LoadedManifest {
  if (!raw || raw.trim() === "") return { manifest: DEVELOPMENT_MANIFEST, source: "none" };
  let text = raw.trim();
  let source: LoadedManifest["source"] = "environment";
  if (!text.startsWith("{")) {
    if (!existsSync(text)) return { manifest: DEVELOPMENT_MANIFEST, source: "file", error: `Manifest file not found: ${text}` };
    text = readFileSync(text, "utf8");
    source = "file";
  }
  try {
    const parsed = manifestSchema.safeParse(JSON.parse(text));
    if (!parsed.success) return { manifest: DEVELOPMENT_MANIFEST, source, error: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") };
    return { manifest: parsed.data, source };
  } catch (e) {
    return { manifest: DEVELOPMENT_MANIFEST, source, error: `Manifest is not valid JSON: ${(e as Error).message}` };
  }
}
