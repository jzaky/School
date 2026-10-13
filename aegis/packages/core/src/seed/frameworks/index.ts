/**
 * Shared framework catalog seed. Shared frameworks have org_id NULL and are readable by every
 * tenant through RLS, so they can only be written with the owner connection. Idempotent: upsert by
 * key, controls upsert by (frameworkId, code); controls removed from the catalog are deleted unless
 * findings reference them.
 */
import { ownerPrisma } from "@aegis/db";
import { ISO_42001 } from "./iso-42001.js";
import { ISO_27001 } from "./iso-27001.js";
import { NIST_AI_RMF } from "./nist-ai-rmf.js";
import { EU_AI_ACT } from "./eu-ai-act.js";
import { GDPR } from "./gdpr.js";
import { UAE_PDPL } from "./uae-pdpl.js";
import { DESC_ISR } from "./desc-isr.js";
import { ISO_23894, ISO_27017, ISO_27018, ISO_27701, ISO_38507, ISO_42005 } from "./iso-extra.js";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { frameworkSeedSchema, type FrameworkSeed } from "./types.js";

export { ISO_42001, ISO_27001, NIST_AI_RMF, EU_AI_ACT, GDPR, UAE_PDPL, DESC_ISR, ISO_23894, ISO_27017, ISO_27018, ISO_27701, ISO_38507, ISO_42005 };
export type { FrameworkSeed, ControlSeed } from "./types.js";

/** Catalogs written in TypeScript. */
const CODED_FRAMEWORKS: FrameworkSeed[] = [ISO_42001, ISO_27001, NIST_AI_RMF, EU_AI_ACT, GDPR, UAE_PDPL, DESC_ISR, ISO_23894, ISO_27701, ISO_27017, ISO_27018, ISO_42005, ISO_38507];

const CATALOG_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "catalogs");

/**
 * Drop-in catalogs: every `*.json` file in ./catalogs is a FrameworkSeed (see types.ts and
 * docs/FRAMEWORKS.md). Files are validated and sorted by name; a duplicate key is an error.
 * `scripts/new-catalog.mjs` scaffolds a file.
 */
export function loadJsonCatalogs(dir = CATALOG_DIR): FrameworkSeed[] {
  if (!existsSync(dir)) return [];
  const out: FrameworkSeed[] = [];
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".json")).sort()) {
    const raw = JSON.parse(readFileSync(join(dir, file), "utf8")) as unknown;
    const parsed = frameworkSeedSchema.safeParse(raw);
    if (!parsed.success) throw new Error(`Catalog ${file} is invalid: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
    out.push(parsed.data);
  }
  return out;
}

export const JSON_FRAMEWORKS: FrameworkSeed[] = loadJsonCatalogs();

export const SHARED_FRAMEWORKS: FrameworkSeed[] = (() => {
  const all = [...CODED_FRAMEWORKS, ...JSON_FRAMEWORKS];
  const seen = new Set<string>();
  for (const f of all) {
    if (seen.has(f.key)) throw new Error(`Duplicate framework key ${f.key}`);
    seen.add(f.key);
  }
  return all;
})();

export interface SeedFrameworksResult {
  frameworks: { key: string; id: string; controls: number }[];
}

export async function seedSharedFrameworks(): Promise<SeedFrameworksResult> {
  const owner = ownerPrisma();
  const out: SeedFrameworksResult = { frameworks: [] };
  for (const f of SHARED_FRAMEWORKS) {
    const existing = await owner.framework.findFirst({ where: { key: f.key, orgId: null } });
    const data = { name: f.name, version: f.version, publisher: f.publisher, licenseNote: f.licenseNote, description: f.description, isCustom: false };
    const row = existing ? await owner.framework.update({ where: { id: existing.id }, data }) : await owner.framework.create({ data: { ...data, key: f.key, orgId: null } });
    const codes = new Set<string>();
    f.controls.forEach((c, i) => {
      if (codes.has(c.code)) throw new Error(`Duplicate control code ${c.code} in ${f.key}`);
      codes.add(c.code);
      void i;
    });
    for (let i = 0; i < f.controls.length; i++) {
      const c = f.controls[i]!;
      const controlData = { title: c.title, summary: c.summary, category: c.category, keywords: c.keywords, automatedEvidenceType: c.automatedEvidenceType ?? null, sortOrder: (i + 1) * 10 };
      await owner.control.upsert({ where: { frameworkId_code: { frameworkId: row.id, code: c.code } }, create: { frameworkId: row.id, code: c.code, ...controlData }, update: controlData });
    }
    const stale = await owner.control.findMany({ where: { frameworkId: row.id, code: { notIn: [...codes] } }, select: { id: true, _count: { select: { findings: true } } } });
    for (const s of stale) if (s._count.findings === 0) await owner.control.delete({ where: { id: s.id } });
    out.frameworks.push({ key: f.key, id: row.id, controls: f.controls.length });
  }
  return out;
}
