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
  MIGRATION_DATABASE_URL: z.string().optional(),
  REDIS_URL: z.string().optional(),
  AEGIS_MASTER_KEY: z.string().min(32, "AEGIS_MASTER_KEY must be 32 random bytes, base64"),
  AEGIS_SESSION_SECRET: z.string().min(32),
  EVIDENCE_SIGNING_KEY: z.string().optional(),
  API_PORT: z.coerce.number().default(4000),
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
  EMAIL_FROM: z.string().default("aegis@example.com"),
  LOG_LEVEL: z.string().default("info"),
  AEGIS_STORAGE_DIR: z.string().default(".uploads"),
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

export function isProduction(): boolean {
  return env().NODE_ENV === "production";
}
