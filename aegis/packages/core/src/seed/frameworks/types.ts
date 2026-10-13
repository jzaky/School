import { z } from "zod";

export interface ControlSeed {
  code: string;
  title: string;
  /** Original AEGIS wording describing the control objective. Never the standard's text. */
  summary: string;
  category: string;
  keywords: string[];
  automatedEvidenceType?: string;
}

export interface FrameworkSeed {
  key: string;
  name: string;
  version: string;
  publisher: string;
  licenseNote: string;
  description: string;
  controls: ControlSeed[];
}

/** Helper that keeps the data files compact. */
export function control(code: string, title: string, summary: string, category: string, keywords: string[], automatedEvidenceType?: string): ControlSeed {
  return { code, title, summary, category, keywords, ...(automatedEvidenceType ? { automatedEvidenceType } : {}) };
}

/** Validates a catalog file (JSON drop-in or TypeScript) before it is seeded. */
export const controlSeedSchema = z.object({
  code: z.string().trim().min(1).max(40),
  title: z.string().trim().min(3).max(200),
  summary: z.string().trim().min(20).max(1000),
  category: z.string().trim().min(1).max(120),
  keywords: z.array(z.string().trim().min(1).max(60)).min(1).max(30),
  automatedEvidenceType: z.string().trim().max(60).optional(),
});

export const frameworkSeedSchema = z.object({
  key: z.string().regex(/^[a-z0-9][a-z0-9.-]*[a-z0-9]$/, "lowercase letters, digits, dots and hyphens"),
  name: z.string().trim().min(2).max(120),
  version: z.string().trim().max(40),
  publisher: z.string().trim().max(120),
  licenseNote: z.string().trim().min(40).max(2000),
  description: z.string().trim().min(20).max(2000),
  controls: z.array(controlSeedSchema).min(1).max(500),
});
