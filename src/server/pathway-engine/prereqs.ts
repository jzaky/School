// Prerequisites between standard curriculum courses, by global CurriculumCourse code. Pure data.
// Each entry is a list of groups; every group needs ONE of its codes in an earlier grade.
// Only standard sequences live here (they hold for most schools); a course without an entry has none.
export const COURSE_PREREQUISITES: Record<string, string[][]> = {
  // American mathematics. Geometry and Algebra II may be taken in the same year ("doubling up").
  US_GEOM: [["US_ALG1", "US_ALG1_H"]],
  US_GEOM_H: [["US_ALG1", "US_ALG1_H"]],
  US_ALG2: [["US_ALG1", "US_ALG1_H"]],
  US_ALG2_H: [["US_ALG1", "US_ALG1_H"]],
  US_PRECALC: [["US_ALG2", "US_ALG2_H"], ["US_GEOM", "US_GEOM_H"]],
  US_PRECALC_H: [["US_ALG2_H", "US_ALG2"], ["US_GEOM_H", "US_GEOM"]],
  US_CALC: [["US_PRECALC", "US_PRECALC_H"]],
  AP_CALC_AB: [["US_PRECALC_H", "US_PRECALC"]],
  AP_CALC_BC: [["US_PRECALC_H", "US_PRECALC"]],
  AP_STATS: [["US_ALG2_H", "US_ALG2"]],
  // American sciences and computing.
  US_CHEM: [["US_BIO", "US_BIO_H"]],
  US_CHEM_H: [["US_BIO", "US_BIO_H"]],
  US_PHYS_H: [["US_ALG1", "US_ALG1_H"]],
  AP_PHYS_1: [["US_ALG1_H", "US_ALG1"]],
  AP_PHYS_2: [["AP_PHYS_1"]],
  AP_PHYS_C_MECH: [["AP_PHYS_1", "US_PHYS_H", "US_PHYS"], ["US_PRECALC_H", "US_PRECALC"]],
  AP_CHEM: [["US_CHEM_H", "US_CHEM"]],
  AP_BIO: [["US_BIO", "US_BIO_H"], ["US_CHEM_H", "US_CHEM"]],
  AP_CSA: [["US_INTRO_CS", "AP_CSP"]],
  AP_ENG_LANG: [["US_ENG10"]],
  AP_ENG_LIT: [["US_ENG10"]],
  // British: A-levels build on the matching IGCSE or GCSE.
  AL_MATH: [["IGCSE_MATH", "GCSE_MATH", "IGCSE_ADD_MATH"]],
  AL_FURTHER_MATH: [["IGCSE_MATH", "GCSE_MATH", "IGCSE_ADD_MATH"]],
  AL_PHYS: [["IGCSE_PHYS", "GCSE_PHYS", "IGCSE_COMB_SCI"]],
  AL_CHEM: [["IGCSE_CHEM", "GCSE_CHEM", "IGCSE_COMB_SCI"]],
  AL_BIO: [["IGCSE_BIO", "GCSE_BIO", "IGCSE_COMB_SCI"]],
  AL_CS: [["IGCSE_CS", "GCSE_CS", "IGCSE_MATH"]],
};

/** Groups for a course code (empty when it has no prerequisites). */
export const prerequisitesOf = (code: string | null | undefined): string[][] => (code ? (COURSE_PREREQUISITES[code] ?? []) : []);
