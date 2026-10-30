import { config } from "dotenv";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

// Load the monorepo root .env once, without overriding real environment variables.
const here = dirname(fileURLToPath(import.meta.url));
for (const candidate of [join(here, "..", "..", "..", ".env"), join(process.cwd(), ".env")]) {
  if (existsSync(candidate)) config({ path: candidate, override: false });
}

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().min(1),
  /** Owner-role URL. Only migrations, seeds and platform scripts may carry it; an empty string counts as unset. */
  MIGRATION_DATABASE_URL: z.string().optional().transform((v) => (v && v.trim() !== "" ? v : undefined)),
  /** Which process this is (api, web, worker, migrate, script). Used by the startup guard. */
  AEGIS_PROCESS: z.enum(["api", "web", "worker", "migrate", "script"]).optional(),
  REDIS_URL: z.string().optional(),
  /** With AEGIS_KEY_PROVIDER=env: the 32-byte data key, base64. With a vault provider: that data key wrapped by the vault, base64. */
  AEGIS_MASTER_KEY: z.string().min(32, "AEGIS_MASTER_KEY must be 32 random bytes, base64 (or a vault-wrapped data key)"),
  /** Where the data key is held: in the environment, or wrapped by AWS KMS or Azure Key Vault (see lib/keyring.ts). */
  AEGIS_KEY_PROVIDER: z.enum(["env", "aws-kms", "azure-keyvault"]).default("env"),
  /** Id recorded in every new envelope; change it when rotating to a new data key. */
  AEGIS_MASTER_KEY_ID: z.string().default("k1"),
  /** Retired data keys still allowed to decrypt, "id:value,id:value", same form as AEGIS_MASTER_KEY. */
  AEGIS_PREVIOUS_MASTER_KEYS: z.string().optional(),
  /** AWS KMS: the key id or ARN that wraps the data key. Region and credentials come from the standard AWS settings. */
  AEGIS_KMS_KEY_ID: z.string().optional(),
  /** Azure Key Vault: the key identifier, https://<vault>.vault.azure.net/keys/<name>/<version>. */
  AEGIS_AZURE_KEY_URL: z.string().optional(),
  AZURE_TENANT_ID: z.string().optional(),
  AZURE_CLIENT_ID: z.string().optional(),
  AZURE_CLIENT_SECRET: z.string().optional(),
  AZURE_AUTHORITY_HOST: z.string().default("https://login.microsoftonline.com"),
  AEGIS_SESSION_SECRET: z.string().min(32),
  EVIDENCE_SIGNING_KEY: z.string().optional(),
  /** Retired evidence public keys (SPKI PEM, base64, comma separated) kept so old checkpoints still verify after a rotation. */
  EVIDENCE_VERIFY_KEYS: z.string().optional(),
  API_PORT: z.coerce.number().default(4000),
  /** Port for the AI gateway when it runs as its own process (pnpm --filter @aegis/api start:ai-gateway). */
  AI_GATEWAY_PORT: z.coerce.number().default(4100),
  API_PUBLIC_URL: z.string().default("http://localhost:4000"),
  WEB_PUBLIC_URL: z.string().default("http://localhost:3000"),
  API_CORS_ORIGINS: z.string().default("http://localhost:3000"),
  AEGIS_DEMO_MODE: z
    .string()
    .default("false")
    .transform((v) => v === "true" || v === "1"),
  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().optional(),
  OTEL_SERVICE_NAME: z.string().default("aegis"),
  RESEND_API_KEY: z.string().optional(),
  /** Resend API base; only tests point it elsewhere. */
  RESEND_API_BASE: z.string().default("https://api.resend.com"),
  EMAIL_FROM: z.string().default("aegis@example.com"),
  /** Sends an email copy of approval requests, quarantines, raised alerts and new incidents (notify/email.ts). Off by default. */
  AEGIS_EMAIL_NOTIFICATIONS: z
    .string()
    .default("false")
    .transform((v) => v === "true" || v === "1"),
  LOG_LEVEL: z.string().default("info"),
  AEGIS_STORAGE_DIR: z.string().default(".uploads"),
  /** Lets event destinations point at private or loopback addresses (local fakes in tests). Refused in production. */
  AEGIS_ALLOW_PRIVATE_DESTINATIONS: z
    .string()
    .default("false")
    .transform((v) => v === "true" || v === "1"),
  /** Bearer token for the Prometheus /metrics endpoint. Unset: only same-host requests are answered. */
  AEGIS_METRICS_TOKEN: z.string().min(16).optional(),
  /** Gateway decisions one API process makes at once before refusing with 503 (backpressure). */
  AEGIS_GATEWAY_MAX_IN_FLIGHT: z.coerce.number().int().min(1).max(10_000).default(64),
  /** When set, the worker serves its Prometheus metrics on 127.0.0.1 at this port. */
  AEGIS_WORKER_METRICS_PORT: z.coerce.number().int().min(1024).max(65535).optional(),
  /** HTTPS endpoint (for example a chat or paging webhook) that receives operational alerts. Optional. */
  AEGIS_OPS_ALERT_WEBHOOK: z.string().url().optional(),
  /** Deployment manifest: inline JSON or a path (deploy/profiles). Unset means nothing is declared. */
  AEGIS_DEPLOYMENT_MANIFEST: z.string().optional(),
  AEGIS_APP_PASSWORD: z.string().optional().transform((v) => (v && v.trim() !== "" ? v : undefined)),
});

export type Env = z.infer<typeof schema>;

let cached: Env | undefined;
export function env(): Env {
  if (!cached) {
    const parsed = schema.safeParse(process.env);
    if (!parsed.success) {
      const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
      throw new Error(`Invalid environment: ${issues}`);
    }
    cached = parsed.data;
  }
  return cached;
}

/** Tests only: re-read process.env on the next env() call. */
export function resetEnvForTests(): void {
  cached = undefined;
}

export function isProduction(): boolean {
  return env().NODE_ENV === "production";
}
