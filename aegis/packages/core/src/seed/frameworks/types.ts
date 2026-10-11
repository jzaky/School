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
