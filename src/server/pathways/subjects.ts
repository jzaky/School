// Subject vocabulary used by programme requirements. Codes match the school's Subject.code where the
// school teaches the subject (MATH, PHYS, CS...). Labels live in messages under pathways.subject.<CODE>.
export const PATHWAY_SUBJECTS = [
  "MATH",
  "FURTHER_MATH",
  "PHYS",
  "CHEM",
  "BIO",
  "CS",
  "ENG",
  "ENG_LIT",
  "ECON",
  "BUS",
  "GEO",
  "HIST",
  "PSY",
  "ART",
  "DT",
  "FR",
  "ARAB",
] as const;
export type PathwaySubject = (typeof PATHWAY_SUBJECTS)[number];

export const isPathwaySubject = (code: string): code is PathwaySubject => (PATHWAY_SUBJECTS as readonly string[]).includes(code);
