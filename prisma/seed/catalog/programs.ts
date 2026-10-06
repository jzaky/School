// Global programme catalog with structured, versioned entry requirements.
//
// ACCURACY: every requirement row here has confidence EXAMPLE. The build environment cannot reach
// university websites, so values are realistic examples of typical published offers, not checked
// facts. sourceUrl points to the university's official admissions page so a person can confirm it,
// and the app labels these rows "Example data, confirm on the official page". Evidence quotes are
// left empty on purpose: a quote must be copied from the page, never invented.
//
// Programmes are generated from field templates and each university's selectivity tier, so a
// computing programme at a very selective UK university asks for more than one at an accessible one.
import type { SchoolCurriculum, SubjectLevel, SubjectRequirementType } from "@prisma/client";
import { PROGRAMS as LEGACY_PROGRAMS } from "../academics/pathways-data";
import { GLOBAL_UNIVERSITIES, type GlobalUniversity } from "./universities";

type Bi = { en: string; ar: string };
type Group = "CS" | "ENG" | "ENG_CHEM" | "ENG_BIO" | "MED" | "DENT" | "VET" | "PHARM" | "NURSE" | "PHYSIO" | "BIO" | "CHEM" | "PHYS" | "MATH" | "SCI" | "ECON" | "FIN" | "BUS" | "LAW" | "PSY" | "ARCH" | "DESIGN" | "MEDIA" | "IR" | "EDU";

type Template = { en: string; ar: string; group: Group; fieldKeys: string[]; legacyField: string };

export const TEMPLATES: Record<string, Template> = {
  cs: { en: "Computer Science", ar: "علوم الحاسوب", group: "CS", fieldKeys: ["computer_science", "software_engineering", "artificial_intelligence"], legacyField: "computer_science" },
  ai: { en: "Artificial Intelligence", ar: "الذكاء الاصطناعي", group: "CS", fieldKeys: ["artificial_intelligence", "computer_science", "data_science"], legacyField: "computer_science" },
  ds: { en: "Data Science", ar: "علم البيانات", group: "CS", fieldKeys: ["data_science", "mathematics", "artificial_intelligence"], legacyField: "computer_science" },
  se: { en: "Software Engineering", ar: "هندسة البرمجيات", group: "CS", fieldKeys: ["software_engineering", "computer_science"], legacyField: "computer_science" },
  cyber: { en: "Cybersecurity", ar: "الأمن السيبراني", group: "CS", fieldKeys: ["cybersecurity", "computer_science"], legacyField: "computer_science" },
  ce: { en: "Computer Engineering", ar: "هندسة الحاسوب", group: "ENG", fieldKeys: ["computer_engineering", "electrical_engineering", "computer_science"], legacyField: "engineering" },
  ee: { en: "Electrical and Electronic Engineering", ar: "الهندسة الكهربائية والإلكترونية", group: "ENG", fieldKeys: ["electrical_engineering", "computer_engineering", "energy_engineering"], legacyField: "engineering" },
  me: { en: "Mechanical Engineering", ar: "الهندسة الميكانيكية", group: "ENG", fieldKeys: ["mechanical_engineering", "mechatronics"], legacyField: "engineering" },
  mech: { en: "Mechatronics and Robotics Engineering", ar: "هندسة الميكاترونكس والروبوتات", group: "ENG", fieldKeys: ["mechatronics", "mechanical_engineering", "electrical_engineering"], legacyField: "engineering" },
  civil: { en: "Civil Engineering", ar: "الهندسة المدنية", group: "ENG", fieldKeys: ["civil_engineering", "urban_planning"], legacyField: "engineering" },
  aero: { en: "Aerospace Engineering", ar: "هندسة الطيران والفضاء", group: "ENG", fieldKeys: ["aerospace_engineering", "mechanical_engineering", "aviation"], legacyField: "engineering" },
  chemeng: { en: "Chemical Engineering", ar: "الهندسة الكيميائية", group: "ENG_CHEM", fieldKeys: ["chemical_engineering", "energy_engineering"], legacyField: "engineering" },
  bme: { en: "Biomedical Engineering", ar: "الهندسة الطبية الحيوية", group: "ENG_BIO", fieldKeys: ["biomedical_engineering", "biomedical_science"], legacyField: "engineering" },
  eng: { en: "Engineering", ar: "الهندسة", group: "ENG", fieldKeys: ["mechanical_engineering", "electrical_engineering", "civil_engineering", "energy_engineering"], legacyField: "engineering" },
  med: { en: "Medicine", ar: "الطب", group: "MED", fieldKeys: ["medicine"], legacyField: "medicine" },
  dent: { en: "Dentistry", ar: "طب الأسنان", group: "DENT", fieldKeys: ["dentistry"], legacyField: "medicine" },
  vet: { en: "Veterinary Medicine", ar: "الطب البيطري", group: "VET", fieldKeys: ["veterinary_medicine"], legacyField: "medicine" },
  pharm: { en: "Pharmacy", ar: "الصيدلة", group: "PHARM", fieldKeys: ["pharmacy", "chemistry"], legacyField: "medicine" },
  nursing: { en: "Nursing", ar: "التمريض", group: "NURSE", fieldKeys: ["nursing"], legacyField: "health" },
  physio: { en: "Physiotherapy", ar: "العلاج الطبيعي", group: "PHYSIO", fieldKeys: ["physiotherapy", "sports_science"], legacyField: "health" },
  biomed: { en: "Biomedical Sciences", ar: "العلوم الطبية الحيوية", group: "BIO", fieldKeys: ["biomedical_science", "biology"], legacyField: "science" },
  bio: { en: "Biology", ar: "الأحياء", group: "BIO", fieldKeys: ["biology", "environmental_science"], legacyField: "science" },
  chem: { en: "Chemistry", ar: "الكيمياء", group: "CHEM", fieldKeys: ["chemistry"], legacyField: "science" },
  phys: { en: "Physics", ar: "الفيزياء", group: "PHYS", fieldKeys: ["physics", "mathematics"], legacyField: "science" },
  math: { en: "Mathematics", ar: "الرياضيات", group: "MATH", fieldKeys: ["mathematics", "data_science"], legacyField: "science" },
  sci: { en: "Natural Sciences", ar: "العلوم الطبيعية", group: "SCI", fieldKeys: ["physics", "chemistry", "biology", "environmental_science"], legacyField: "science" },
  psy: { en: "Psychology", ar: "علم النفس", group: "PSY", fieldKeys: ["psychology"], legacyField: "psychology" },
  law: { en: "Law", ar: "القانون", group: "LAW", fieldKeys: ["law"], legacyField: "law" },
  bus: { en: "Business Administration", ar: "إدارة الأعمال", group: "BUS", fieldKeys: ["business", "marketing", "hospitality"], legacyField: "business" },
  econ: { en: "Economics", ar: "الاقتصاد", group: "ECON", fieldKeys: ["economics", "finance"], legacyField: "economics" },
  fin: { en: "Accounting and Finance", ar: "المحاسبة والتمويل", group: "FIN", fieldKeys: ["finance", "accounting", "economics"], legacyField: "economics" },
  arch: { en: "Architecture", ar: "العمارة", group: "ARCH", fieldKeys: ["architecture", "urban_planning", "design"], legacyField: "architecture" },
  design: { en: "Design", ar: "التصميم", group: "DESIGN", fieldKeys: ["design", "media"], legacyField: "design" },
  media: { en: "Media and Communication", ar: "الإعلام والاتصال", group: "MEDIA", fieldKeys: ["media", "marketing"], legacyField: "media" },
  ir: { en: "International Relations", ar: "العلاقات الدولية", group: "IR", fieldKeys: ["international_relations", "law", "economics"], legacyField: "international_relations" },
  edu: { en: "Education", ar: "التربية والتعليم", group: "EDU", fieldKeys: ["education", "psychology"], legacyField: "education" },
};

/** Which programmes each university offers in the catalog (legacy programmes are added from pathways-data). */
const OFFERS: Record<string, string> = {
  oxford: "cs eng law",
  cambridge: "med eng econ",
  imperial_college_london: "ai ee med",
  ucl: "ee med law ds",
  kings_college_london: "med dent ai",
  edinburgh: "cs ai med",
  manchester: "cs ee pharm bus",
  lse: "law ds bus",
  warwick: "cs math econ",
  bristol: "cs ee med",
  glasgow: "cs med",
  durham: "cs law",
  st_andrews: "cs med",
  leeds: "cs me med",
  southampton: "cs ai ee",
  nottingham: "cs pharm",
  birmingham: "cs ai med",
  bath: "cs me",
  exeter: "cs bus",
  sheffield: "ai aero",
  qmul: "cs dent",
  mit: "ee ai me",
  stanford: "ee ds",
  harvard: "cs econ",
  carnegie_mellon: "ai ce",
  uc_berkeley: "ds me",
  cornell: "cs ce",
  johns_hopkins: "cs bme",
  university_of_michigan: "cs bus",
  georgia_tech: "cs ce me",
  uiuc: "cs ce",
  purdue: "cs aero",
  columbia: "cs ee",
  ucla: "cs psy",
  ut_austin: "cs ee",
  uw_seattle: "cs ce",
  northeastern: "cs ds cyber",
  nyu: "cs ds bus",
  university_of_toronto: "ce bus",
  mcgill: "cs ee",
  ubc: "cs eng",
  waterloo: "se ce mech ds",
  mcmaster: "eng biomed",
  university_of_alberta: "cs eng",
  queens_university: "cs eng",
  western: "cs bus",
  khalifa_university: "ce ee me aero",
  mbzuai: "ai",
  uae_university: "cs ai ee bus law",
  american_university_sharjah: "cs ce ee me bus",
  nyu_abu_dhabi: "ce ee econ",
  university_of_sharjah: "med dent pharm cs",
  zayed_university: "cs cyber bus",
  heriot_watt_dubai: "cs me bus",
  birmingham_dubai: "cs ai bus",
  middlesex_dubai: "cs cyber",
  sorbonne_abu_dhabi: "law econ",
  rit_dubai: "se cyber ee",
  wollongong_dubai: "cs bus",
  abu_dhabi_university: "cs ai ee law",
  aud: "cs bus",
  ajman_university: "cs dent pharm law bus",
  canadian_university_dubai: "bus arch media psy",
  manipal_dubai: "cs ai bus psy",
  bits_dubai: "cs ee me chemeng",
  curtin_dubai: "cs eng bus psy",
  amity_dubai: "cs ai bus psy",
  murdoch_dubai: "cs bus psy media",
  al_ain_university: "cs pharm law bus",
  gulf_medical_university: "med dent pharm physio",
  mbru: "med",
  emirates_aviation_university: "aero ai bus",
  university_of_dubai: "cs cyber ee bus",
  kfupm: "cs ce ee me chemeng civil",
  king_saud_university: "med dent pharm cs ee bus",
  king_abdulaziz_university: "med cs ee me bus",
  alfaisal: "med pharm se ee bus law",
  prince_sultan_university: "cs se cyber law bus arch",
  effat: "cs ee arch psy bus",
  iau: "med dent pharm nursing arch",
  ubt_jeddah: "cs ee me bus",
  pmu: "cs ce me civil law bus",
  dar_al_hekma: "cs cyber law arch design bus",
  umm_al_qura: "med dent pharm cs eng",
  al_yamamah: "cs se bus law arch",
  university_of_jordan: "dent pharm cs",
  just: "dent cs ee",
  psut: "cyber ds",
  gju: "ee",
  yarmouk: "bus",
  unimelb: "bus",
  unsw: "cs ai med",
  usyd: "cs law",
  monash: "cs med pharm",
  anu: "cs econ",
  uq: "cs med",
  trinity_college_dublin: "med law",
  ucd: "cs med",
  rcsi: "med pharm",
  tu_delft: "cs me",
  university_of_amsterdam: "econ ai",
  tu_eindhoven: "cs ds",
  leiden: "ir",
  tu_munich: "ee",
  rwth_aachen: "cs me",
  lmu_munich: "cs",
  kit: "cs",
  eth_zurich: "cs ee",
  epfl: "cs",
  sciences_po: "ir",
  ie_university: "bus ds",
  nus: "cs ai ce med law",
  ntu: "cs ai ee",
  hku: "cs med law",
  hkust: "cs ai",
  cuhk: "cs med",
};

/** Legacy programme keys (kept so existing shortlists still find them) and their template. */
const LEGACY_TEMPLATE: Record<string, string> = {
  "ucl-computer-science-bsc": "cs",
  "imperial-computing-beng": "cs",
  "cambridge-computer-science-ba": "cs",
  "oxford-medicine-bmbch": "med",
  "manchester-medicine-mbchb": "med",
  "lse-economics-bsc": "econ",
  "kcl-law-llb": "law",
  "ucl-psychology-bsc": "psy",
  "ucl-architecture-bsc": "arch",
  "imperial-mechanical-engineering-meng": "me",
  "warwick-management-bsc": "bus",
  "mit-computer-science-sb": "cs",
  "stanford-computer-science-bs": "cs",
  "cmu-computer-science-bs": "cs",
  "berkeley-eecs-bs": "cs",
  "umich-engineering-bse": "eng",
  "nyuad-computer-science-bs": "cs",
  "ku-computer-science-bsc": "cs",
  "uaeu-medicine-md": "med",
  "aus-architecture-barch": "arch",
  "ju-medicine-md": "med",
  "ju-law-llb": "law",
  "ju-business-administration-bba": "bus",
  "just-medicine-md": "med",
  "just-civil-engineering-bsc": "civil",
  "psut-computer-science-bsc": "cs",
  "gju-mechanical-engineering-bsc": "me",
  "yarmouk-computer-science-bsc": "cs",
  "uoft-computer-science-bsc": "cs",
  "waterloo-computer-science-bcs": "cs",
  "unimelb-science-bsc": "sci",
  "tudelft-aerospace-bsc": "aero",
  "uva-psychology-bsc": "psy",
  "tum-informatics-bsc": "cs",
  "tcd-computer-science-ba": "cs",
};

// ---------------------------------------------------------------------------------------------
// Output types

export type SubjectLineSeed = { type: SubjectRequirementType; keys: string[]; minimumLevel: SubjectLevel | null; minimumGrade: string | null; noteEn?: string | null; noteAr?: string | null };
export type RowSeed = {
  curriculum: SchoolCurriculum | null;
  minimumGPA: number | null;
  minimumPercent: number | null;
  minimumPoints: number | null;
  gradeProfile: string | null;
  stream: string | null;
  notesEn: string | null;
  notesAr: string | null;
  evidenceLocator: string | null;
  subjects: SubjectLineSeed[];
  languages: Array<{ test: string; minOverall: number; minComponent: number | null; waiverNoteEn: string | null }>;
  tests: Array<{ test: string; policy: string; minScore: number | null; noteEn: string | null }>;
  additional: Array<{ kind: string; required: boolean; noteEn: string | null; noteAr: string | null }>;
};
export type ProgramSeed = {
  key: string;
  uni: string;
  name: Bi;
  template: string;
  field: string;
  fieldKeys: string[];
  degree: string;
  degreeType: string;
  durationYears: number;
  tuitionPerYear: number | null;
  tuitionCurrency: string | null;
  teachingLanguage: string;
  sourceUrl: string;
  notes: Bi | null;
  rows: RowSeed[];
};

// ---------------------------------------------------------------------------------------------
// Degrees, durations, tuition, language

const MATH_HEAVY = new Set<Group>(["CS", "ENG", "ENG_CHEM", "ENG_BIO", "PHYS", "MATH", "ECON"]);
const STEM = new Set<Group>(["CS", "ENG", "ENG_CHEM", "ENG_BIO", "MED", "DENT", "VET", "PHARM", "BIO", "CHEM", "PHYS", "MATH", "SCI"]);
const HEALTH = new Set<Group>(["MED", "DENT", "VET", "PHARM"]);
const SCOTLAND = new Set(["edinburgh", "glasgow", "st_andrews"]);
const PUBLIC_US = new Set(["uc_berkeley", "ucla", "university_of_michigan", "uiuc", "purdue", "georgia_tech", "ut_austin", "uw_seattle"]);
const GERMAN_TAUGHT = new Set(["rwth_aachen", "lmu_munich", "kit", "eth_zurich"]);
const FRENCH_TAUGHT = new Set(["epfl"]);

function degreeFor(tpl: string, g: Group, u: GlobalUniversity): { degree: string; ar: string } {
  const c = u.countryCode;
  if (g === "MED") {
    if (c === "GB") return u.key === "oxford" ? { degree: "BMBCh", ar: "بكالوريوس الطب والجراحة" } : { degree: "MBChB", ar: "بكالوريوس الطب والجراحة" };
    if (["AE", "JO", "CA", "US"].includes(c)) return { degree: "MD", ar: "دكتور في الطب" };
    return { degree: "MBBS", ar: "بكالوريوس الطب والجراحة" };
  }
  if (g === "DENT") return { degree: c === "JO" || c === "AE" ? "DDS" : "BDS", ar: "بكالوريوس طب وجراحة الأسنان" };
  if (g === "VET") return { degree: "BVMS", ar: "بكالوريوس الطب البيطري" };
  if (g === "PHARM") return c === "GB" || c === "AU" || c === "IE" ? { degree: "MPharm", ar: "ماجستير الصيدلة" } : { degree: "PharmD", ar: "دكتور صيدلة" };
  if (g === "LAW") return c === "US" ? { degree: "BA", ar: "بكالوريوس" } : { degree: "LLB", ar: "بكالوريوس" };
  if (g === "ARCH") return c === "GB" ? { degree: "BA", ar: "بكالوريوس" } : { degree: "BArch", ar: "بكالوريوس" };
  if (g === "BUS" || g === "FIN") return c === "US" ? { degree: "BS", ar: "بكالوريوس" } : c === "CA" ? { degree: "BCom", ar: "بكالوريوس" } : c === "GB" ? { degree: "BSc", ar: "بكالوريوس" } : { degree: "BBA", ar: "بكالوريوس" };
  if (g === "ENG" || g === "ENG_CHEM" || g === "ENG_BIO") {
    if (c === "GB" && u.tier === 1) return { degree: "MEng", ar: "ماجستير متكامل في" };
    if (c === "GB" || c === "IE") return { degree: "BEng", ar: "بكالوريوس" };
    if (c === "CA") return { degree: "BASc", ar: "بكالوريوس" };
    if (c === "US") return { degree: "BS", ar: "بكالوريوس" };
    return { degree: "BSc", ar: "بكالوريوس" };
  }
  if (["IR", "EDU", "MEDIA", "DESIGN", "PSY"].includes(g) && (c === "US" || c === "GB")) return { degree: g === "PSY" && c === "GB" ? "BSc" : "BA", ar: "بكالوريوس" };
  if (g === "DESIGN") return { degree: "BDes", ar: "بكالوريوس" };
  void tpl;
  return c === "US" ? { degree: "BS", ar: "بكالوريوس" } : { degree: "BSc", ar: "بكالوريوس" };
}

function durationFor(g: Group, degree: string, u: GlobalUniversity): number {
  const c = u.countryCode;
  if (g === "MED") return c === "GB" ? (u.key === "oxford" || u.key === "cambridge" ? 6 : 5) : c === "AE" || c === "JO" || c === "IE" ? 6 : c === "US" || c === "CA" ? 7 : 6;
  if (g === "DENT" || g === "VET") return 5;
  if (g === "PHARM") return c === "JO" || c === "AE" ? 5 : c === "SA" ? 6 : 4;
  if (degree === "MEng") return 4;
  if (c === "GB") return SCOTLAND.has(u.key) ? 4 : g === "ARCH" ? 3 : 3;
  if (c === "AU" || c === "NL" || c === "DE" || c === "CH" || c === "FR") return g === "ENG" || g === "ENG_CHEM" || g === "ENG_BIO" ? (c === "AU" ? 4 : 3) : 3;
  if (c === "JO" && (g === "ENG" || g === "ARCH")) return 5;
  return 4;
}

function tuitionFor(g: Group, u: GlobalUniversity): { amount: number | null; currency: string } {
  const health = HEALTH.has(g);
  switch (u.countryCode) {
    case "GB":
      return { amount: health ? 52000 : u.tier === 1 ? 40000 : u.tier === 2 ? 30000 : 24000, currency: "GBP" };
    case "US":
      return { amount: PUBLIC_US.has(u.key) ? 47000 : 66000, currency: "USD" };
    case "CA":
      return { amount: u.tier === 1 ? 62000 : 45000, currency: "CAD" };
    case "AE":
      return { amount: health ? 160000 : u.tier === 1 ? 90000 : 75000, currency: "AED" };
    case "JO":
      return { amount: health ? 12000 : 4500, currency: "JOD" };
    case "AU":
      return { amount: health ? 85000 : 52000, currency: "AUD" };
    case "IE":
      return { amount: health ? 62000 : 27000, currency: "EUR" };
    case "NL":
      return { amount: 16500, currency: "EUR" };
    case "DE":
      return { amount: u.key === "tu_munich" ? 12000 : u.key === "kit" ? 3000 : 0, currency: "EUR" };
    case "CH":
      return { amount: 4000, currency: "CHF" };
    case "SG":
      return { amount: health ? 75000 : 40000, currency: "SGD" };
    case "HK":
      return { amount: 182000, currency: "HKD" };
    case "FR":
      return { amount: 14000, currency: "EUR" };
    case "ES":
      return { amount: 25000, currency: "EUR" };
    case "SA":
      // No example fee: Saudi fees differ widely by nationality and sponsorship. Filled from official pages only.
      return { amount: null, currency: "SAR" };
    default:
      return { amount: null, currency: "USD" };
  }
}

function teachingLanguage(g: Group, u: GlobalUniversity, legacyKey?: string): string {
  if (legacyKey === "tum-informatics-bsc" || GERMAN_TAUGHT.has(u.key) || (u.key === "tu_munich" && g !== "BUS")) return "de";
  if (FRENCH_TAUGHT.has(u.key)) return "fr";
  if (u.countryCode === "JO" && (g === "LAW" || g === "BUS" || g === "MEDIA")) return "ar";
  if (u.countryCode === "SA" && g === "LAW") return "ar";
  if (u.key === "sorbonne_abu_dhabi") return g === "LAW" ? "fr" : "en";
  return "en";
}

// ---------------------------------------------------------------------------------------------
// Requirement rows

type Need = { type: SubjectRequirementType; keys: string[]; strength: "core" | "second" | "advice" };

function needsFor(g: Group, u: GlobalUniversity): Need[] {
  const REQ = (keys: string[], strength: "core" | "second" = "core"): Need => ({ type: keys.length > 1 ? "ONE_OF" : "REQUIRED", keys, strength });
  const REC = (keys: string[]): Need => ({ type: "RECOMMENDED", keys, strength: "advice" });
  switch (g) {
    case "CS":
      return [REQ(["mathematics"]), REC(["further_mathematics"]), REC(["computer_science"])];
    case "ENG":
      return [REQ(["mathematics"]), REQ(["physics"], "second"), REC(["further_mathematics"])];
    case "ENG_CHEM":
      return [REQ(["mathematics"]), REQ(["chemistry"], "second"), REC(["physics"])];
    case "ENG_BIO":
      return [REQ(["mathematics"]), REQ(["physics", "chemistry", "biology"], "second")];
    case "MED":
      return u.tier === 1 ? [REQ(["chemistry"]), { type: "TWO_OF", keys: ["biology", "physics", "mathematics"], strength: "second" }] : [REQ(["chemistry"]), REQ(["biology"], "second")];
    case "DENT":
    case "VET":
      return [REQ(["chemistry"]), REQ(["biology"], "second"), REC(["mathematics", "physics"])];
    case "PHARM":
      return [REQ(["chemistry"]), REQ(["biology", "mathematics", "physics"], "second")];
    case "NURSE":
      return [REC(["biology"])];
    case "PHYSIO":
      return [REQ(["biology", "physical_education", "sports_science"], "second")];
    case "BIO":
      return [REQ(["biology"]), REQ(["chemistry", "mathematics", "physics"], "second")];
    case "CHEM":
      return [REQ(["chemistry"]), REQ(["mathematics", "physics", "biology"], "second")];
    case "PHYS":
      return [REQ(["mathematics"]), REQ(["physics"]), REC(["further_mathematics"])];
    case "MATH":
      return u.tier === 1 ? [REQ(["mathematics"]), REQ(["further_mathematics"], "second")] : [REQ(["mathematics"]), REC(["further_mathematics"])];
    case "SCI":
      return [{ type: "TWO_OF", keys: ["mathematics", "physics", "chemistry", "biology"], strength: "second" }];
    case "ECON":
      return u.tier <= 2 ? [REQ(["mathematics"]), REC(["economics"])] : [REC(["mathematics"]), REC(["economics"])];
    case "FIN":
      return [REQ(["mathematics"], "second")];
    case "BUS":
      return [REC(["mathematics"]), REC(["economics", "business"])];
    case "LAW":
      return [{ type: "PREFERRED", keys: ["english_literature", "history"], strength: "advice" }];
    case "PSY":
      return [REC(["biology", "mathematics", "psychology"])];
    case "ARCH":
      return [REC(["art"]), REC(["mathematics"])];
    case "DESIGN":
      return [REC(["art", "design_technology"])];
    case "MEDIA":
      return [REC(["english_literature", "media_studies"])];
    case "IR":
      return [{ type: "PREFERRED", keys: ["history", "global_politics", "economics"], strength: "advice" }];
    case "EDU":
      return [];
  }
}

const row = (curriculum: SchoolCurriculum | null, r: Partial<RowSeed> = {}): RowSeed => ({
  curriculum,
  minimumGPA: null,
  minimumPercent: null,
  minimumPoints: null,
  gradeProfile: null,
  stream: null,
  notesEn: null,
  notesAr: null,
  evidenceLocator: null,
  subjects: [],
  languages: [],
  tests: [],
  additional: [],
  ...r,
});

const NOTE_US_HOLISTIC: Bi = {
  en: "Admission is holistic: courses, grades, essays and activities are read together, and there is no fixed grade offer.",
  ar: "القبول شامل: تُقرأ المواد والدرجات والمقالات والأنشطة معًا، ولا يوجد عرض ثابت بالدرجات.",
};
const NOTE_JO_EQUIV: Bi = {
  en: "International certificates need an equivalency from the Jordanian Ministry of Education before admission is confirmed.",
  ar: "تحتاج الشهادات الدولية إلى معادلة من وزارة التربية والتعليم الأردنية قبل تأكيد القبول.",
};
const NOTE_FOUNDATION: Bi = {
  en: "Applicants with the UAE MoE certificate are usually asked to complete a recognised foundation year first. Ask the admissions office.",
  ar: "يُطلب عادة من حملة شهادة وزارة التربية والتعليم الإماراتية إكمال سنة تأسيسية معتمدة أولًا. تواصل مع مكتب القبول.",
};

const UK_TESTS: Record<string, Partial<Record<string, string>>> = {
  cambridge: { CS: "TMUA", ECON: "TMUA", ENG: "ESAT", SCI: "ESAT", MATH: "STEP", LAW: "LNAT" },
  imperial_college_london: { CS: "TMUA", ENG: "ESAT", ENG_CHEM: "ESAT", ENG_BIO: "ESAT", PHYS: "ESAT", MATH: "TMUA" },
  oxford: { CS: "MAT", MATH: "MAT", ENG: "PAT", LAW: "LNAT", CHEM: "TARA" },
  warwick: { CS: "TMUA", MATH: "TMUA", ECON: "TMUA" },
  lse: { ECON: "TMUA", FIN: "TMUA", LAW: "LNAT" },
  ucl: { LAW: "LNAT" },
  kings_college_london: { LAW: "LNAT" },
  bristol: { LAW: "LNAT" },
  glasgow: { LAW: "LNAT" },
  durham: { LAW: "LNAT", MATH: "TMUA" },
  nottingham: { LAW: "LNAT" },
};
const US_TEST_POLICY: Record<string, string> = {
  mit: "REQUIRED",
  stanford: "REQUIRED",
  harvard: "REQUIRED",
  carnegie_mellon: "REQUIRED",
  cornell: "REQUIRED",
  johns_hopkins: "REQUIRED",
  georgia_tech: "REQUIRED",
  purdue: "REQUIRED",
  ut_austin: "REQUIRED",
  uc_berkeley: "BLIND",
  ucla: "BLIND",
};
const INTERVIEWS = new Set(["oxford", "cambridge"]);

function generalRow(g: Group, u: GlobalUniversity, lang: string, tpl: string): RowSeed {
  const c = u.countryCode;
  const r = row(null, { evidenceLocator: "Entry requirements: English language and admissions tests" });
  // English (or teaching language) tests: any one accepted test is enough.
  if (lang === "de") r.languages.push({ test: "TESTDAF", minOverall: 16, minComponent: 4, waiverNoteEn: "German-taught programme: TestDaF 4 in every section or DSH-2." });
  else if (lang === "fr") r.languages.push({ test: "DELF_B2", minOverall: 50, minComponent: null, waiverNoteEn: "French-taught programme: French at B2 or above." });
  else if (lang === "ar") {
    // Arabic-taught: no English test.
  } else if (c === "AE" || c === "JO" || c === "SA") {
    r.languages.push({ test: "IELTS", minOverall: u.tier === 1 ? 6.5 : 6, minComponent: null, waiverNoteEn: null });
    r.languages.push({ test: "TOEFL", minOverall: u.tier === 1 ? 90 : 79, minComponent: null, waiverNoteEn: null });
    if (c === "AE") r.languages.push({ test: "EMSAT_ENGLISH", minOverall: u.tier === 1 ? 1400 : 1100, minComponent: null, waiverNoteEn: null });
  } else {
    const high = u.tier === 1 || HEALTH.has(g) || g === "LAW";
    r.languages.push({ test: "IELTS", minOverall: high ? 7 : u.tier === 2 ? 6.5 : 6, minComponent: high ? 6.5 : 6, waiverNoteEn: c === "US" ? null : "Some universities waive the test after several years of English-medium schooling." });
    r.languages.push({ test: "TOEFL", minOverall: high ? 100 : u.tier === 2 ? 92 : 80, minComponent: null, waiverNoteEn: null });
    if (c === "US" || c === "CA") r.languages.push({ test: "DUOLINGO", minOverall: high ? 125 : 115, minComponent: null, waiverNoteEn: null });
  }
  // Admissions tests.
  if (c === "GB") {
    const t = UK_TESTS[u.key]?.[g];
    if (t) r.tests.push({ test: t, policy: "REQUIRED", minScore: null, noteEn: null });
    if (g === "MED" || g === "DENT") r.tests.push({ test: "UCAT", policy: "REQUIRED", minScore: null, noteEn: "Scores are compared with other applicants each year." });
    r.additional.push({ kind: "PERSONAL_STATEMENT", required: true, noteEn: "UCAS personal statement.", noteAr: "البيان الشخصي عبر UCAS." });
    if (INTERVIEWS.has(u.key) || HEALTH.has(g)) r.additional.push({ kind: "INTERVIEW", required: true, noteEn: "Shortlisted applicants are interviewed.", noteAr: "تُجرى مقابلة للمتقدمين المرشحين." });
  } else if (c === "US") {
    const policy = US_TEST_POLICY[u.key] ?? "OPTIONAL";
    r.tests.push({ test: "SAT", policy, minScore: null, noteEn: null }, { test: "ACT", policy, minScore: null, noteEn: null });
    r.additional.push({ kind: "ESSAYS", required: true, noteEn: "Application essays.", noteAr: "مقالات الطلب." }, { kind: "REFERENCE", required: true, noteEn: "Counselor and teacher recommendations.", noteAr: "توصيات المرشد والمعلمين." });
  } else if (c === "AU" && (g === "MED" || g === "DENT")) {
    r.tests.push({ test: u.key === "unsw" || u.key === "monash" ? "UCAT" : "ISAT", policy: "REQUIRED", minScore: null, noteEn: null });
    r.additional.push({ kind: "INTERVIEW", required: true, noteEn: "Multiple mini interviews.", noteAr: "مقابلات قصيرة متعددة." });
  } else if ((c === "SG" || c === "HK" || c === "IE") && HEALTH.has(g)) {
    r.additional.push({ kind: "INTERVIEW", required: true, noteEn: "Shortlisted applicants are interviewed.", noteAr: "تُجرى مقابلة للمتقدمين المرشحين." });
  } else if ((c === "AE" || c === "SA") && g === "MED") {
    r.additional.push({ kind: "INTERVIEW", required: true, noteEn: "Interview and multiple mini interviews.", noteAr: "مقابلة شخصية ومقابلات قصيرة متعددة." });
  }
  if (g === "ARCH" || g === "DESIGN") r.additional.push({ kind: "PORTFOLIO", required: true, noteEn: "A portfolio of creative work.", noteAr: "ملف أعمال إبداعية." });
  void tpl;
  return r;
}

const gradeFor = (cur: "BRITISH" | "IB" | "AP" | "PCT", strength: Need["strength"], tier: number, mathHeavy: boolean): string | null => {
  if (strength === "advice") return null;
  const core = strength === "core";
  if (cur === "BRITISH") return core ? (tier === 1 ? (mathHeavy ? "A*" : "A") : tier === 2 ? "A" : "B") : tier === 1 ? "A" : tier === 2 ? "B" : "C";
  if (cur === "IB") return core ? (tier === 1 ? (mathHeavy ? "7" : "6") : tier === 2 ? "6" : "5") : tier === 1 ? "6" : tier === 2 ? "5" : "4";
  if (cur === "AP") return core ? (tier === 1 ? "5" : tier === 2 ? "4" : "3") : tier <= 2 ? "4" : null;
  return core ? (tier === 1 ? "90" : tier === 2 ? "85" : "70") : tier === 1 ? "85" : tier === 2 ? "80" : "65";
};

function subjectLines(needs: Need[], level: SubjectLevel | null, grade: (n: Need) => string | null, keyMap: (k: string, n: Need) => string = (k) => k): SubjectLineSeed[] {
  return needs.map((n) => ({ type: n.type, keys: [...new Set(n.keys.map((k) => keyMap(k, n)))], minimumLevel: level, minimumGrade: grade(n) }));
}

function curriculumRows(g: Group, u: GlobalUniversity): RowSeed[] {
  const c = u.countryCode;
  const t = u.tier;
  const mh = MATH_HEAVY.has(g);
  const stem = STEM.has(g);
  const needs = needsFor(g, u);
  const rows: RowSeed[] = [];
  const locator = "Entry requirements: international qualifications";
  const holistic = c === "US";

  // British: A-levels.
  if (holistic) {
    rows.push(row("BRITISH", { evidenceLocator: locator, notesEn: NOTE_US_HOLISTIC.en, notesAr: NOTE_US_HOLISTIC.ar, subjects: subjectLines(needs, "ADVANCED", () => null) }));
  } else if (c === "JO") {
    rows.push(row("BRITISH", { evidenceLocator: locator, subjects: subjectLines(needs, "ADVANCED", () => null), additional: [{ kind: "NOTE", required: true, noteEn: NOTE_JO_EQUIV.en, noteAr: NOTE_JO_EQUIV.ar }] }));
  } else {
    const profile = t === 1 ? (mh && g !== "ECON" ? "A*A*A" : "A*AA") : t === 2 ? (HEALTH.has(g) || mh ? "AAA" : "AAB") : stem ? "ABB" : "BBB";
    rows.push(row("BRITISH", { evidenceLocator: locator, gradeProfile: profile, subjects: subjectLines(needs, "ADVANCED", (n) => gradeFor("BRITISH", n.strength, t, mh)) }));
  }

  // IB Diploma.
  if (holistic) rows.push(row("IB", { evidenceLocator: locator, notesEn: NOTE_US_HOLISTIC.en, notesAr: NOTE_US_HOLISTIC.ar, subjects: subjectLines(needs, "STANDARD", () => null) }));
  else if (c === "JO") rows.push(row("IB", { evidenceLocator: locator, minimumPoints: 28, subjects: subjectLines(needs, "STANDARD", () => null), additional: [{ kind: "NOTE", required: true, noteEn: NOTE_JO_EQUIV.en, noteAr: NOTE_JO_EQUIV.ar }] }));
  else {
    const points = t === 1 ? (mh ? 40 : 38) : t === 2 ? (HEALTH.has(g) ? 36 : 34) : 30;
    rows.push(row("IB", { evidenceLocator: locator, minimumPoints: points, subjects: subjectLines(needs, "HIGHER", (n) => gradeFor("IB", n.strength, t, mh)) }));
  }

  // American high school diploma.
  if (holistic) {
    const us: SubjectLineSeed[] = [{ type: "REQUIRED", keys: ["english_language"], minimumLevel: "STANDARD", minimumGrade: null }];
    if (stem) us.push({ type: "REQUIRED", keys: ["mathematics"], minimumLevel: "STANDARD", minimumGrade: null });
    if (mh) us.push({ type: "REQUIRED", keys: ["precalculus", "calculus"], minimumLevel: "STANDARD", minimumGrade: null }, { type: "RECOMMENDED", keys: ["calculus"], minimumLevel: "ADVANCED", minimumGrade: null });
    if (g === "ENG" || g === "PHYS") us.push({ type: "REQUIRED", keys: ["physics"], minimumLevel: "STANDARD", minimumGrade: null });
    if (g === "CS" || g === "ENG") us.push({ type: "RECOMMENDED", keys: ["computer_science"], minimumLevel: "ADVANCED", minimumGrade: null });
    if (["BIO", "CHEM", "ENG_CHEM", "ENG_BIO", "PHARM"].includes(g)) us.push({ type: "REQUIRED", keys: ["chemistry"], minimumLevel: "STANDARD", minimumGrade: null }, { type: "RECOMMENDED", keys: ["biology"], minimumLevel: "ADVANCED", minimumGrade: null });
    if (!stem) us.push({ type: "RECOMMENDED", keys: ["mathematics"], minimumLevel: "STANDARD", minimumGrade: null });
    rows.push(row("AMERICAN", { evidenceLocator: "First-year applicants: recommended high school preparation", minimumGPA: t === 3 ? 3 : null, notesEn: NOTE_US_HOLISTIC.en, notesAr: NOTE_US_HOLISTIC.ar, subjects: us }));
  } else if (c === "AE" || c === "JO" || c === "SA") {
    const add = c === "JO" ? [{ kind: "NOTE", required: true, noteEn: NOTE_JO_EQUIV.en, noteAr: NOTE_JO_EQUIV.ar }] : [];
    const subjects = subjectLines(needs.filter((n) => n.strength !== "advice"), "STANDARD", () => null);
    const tests = c === "AE" || c === "SA" ? [{ test: "SAT", policy: "OPTIONAL", minScore: t === 1 ? 1300 : 1100, noteEn: "SAT can support the application." }] : [];
    rows.push(row("AMERICAN", { evidenceLocator: locator, minimumGPA: t === 1 ? 3.5 : t === 2 ? 3.0 : 2.7, subjects, tests, additional: add }));
  } else {
    // UK, Canada, Europe, Australia, Singapore, Hong Kong: APs at stated scores (calculus for maths-heavy courses).
    const keyMap = (k: string) => (mh && k === "mathematics" ? "calculus" : k);
    const subjects = subjectLines(needs, "ADVANCED", (n) => gradeFor("AP", n.strength, t, mh), keyMap);
    subjects.push({ type: "REQUIRED", keys: ["english_language"], minimumLevel: "STANDARD", minimumGrade: null });
    const tests = t <= 2 && c !== "CA" ? [{ test: "SAT", policy: "REQUIRED", minScore: t === 1 ? 1470 : 1350, noteEn: null }, { test: "ACT", policy: "REQUIRED", minScore: t === 1 ? 33 : 29, noteEn: null }] : [{ test: "SAT", policy: "OPTIONAL", minScore: null, noteEn: null }];
    rows.push(row("AMERICAN", { evidenceLocator: locator, minimumGPA: t === 1 ? 3.8 : t === 2 ? 3.5 : 3.0, subjects, tests }));
  }

  // UAE Ministry of Education (Advanced, Elite and General streams).
  const moeStream = stem || g === "FIN" || g === "ECON" ? "ADVANCED|ELITE" : "ADVANCED|ELITE|GENERAL";
  if (c === "AE") {
    const pct = (g === "MED" ? 90 : t === 1 ? 90 : t === 2 ? 85 : 75) - (stem ? 0 : 5);
    const tests = stem ? [{ test: "EMSAT_MATH", policy: "OPTIONAL", minScore: t === 1 ? 1100 : 900, noteEn: "EmSAT results can support the application." }] : [];
    rows.push(row("UAE_MOE", { evidenceLocator: "Admission requirements: UAE Secondary School Certificate", minimumPercent: pct, stream: moeStream, subjects: subjectLines(needs.filter((n) => n.strength !== "advice"), "ADVANCED", () => null), tests }));
  } else if (c === "GB" && t === 1) {
    rows.push(row("UAE_MOE", { evidenceLocator: locator, additional: [{ kind: "NOTE", required: true, noteEn: NOTE_FOUNDATION.en, noteAr: NOTE_FOUNDATION.ar }] }));
  } else if (["GB", "AU", "CA", "IE", "US"].includes(c)) {
    rows.push(row("UAE_MOE", { evidenceLocator: locator, minimumPercent: c === "US" ? null : t === 2 ? 90 : 85, stream: moeStream, notesEn: c === "US" ? NOTE_US_HOLISTIC.en : null, notesAr: c === "US" ? NOTE_US_HOLISTIC.ar : null, subjects: subjectLines(needs.filter((n) => n.strength !== "advice"), "ADVANCED", () => null) }));
  }

  // Indian CBSE (and ISC for selective UK, Singapore and Australian universities).
  if (c !== "JO" && c !== "DE" && c !== "CH" && c !== "FR" && c !== "NL") {
    const pct = holistic ? null : t === 1 ? 90 : t === 2 ? 85 : 70;
    const subjects = subjectLines(needs, "ADVANCED", (n) => (holistic ? null : gradeFor("PCT", n.strength, t, mh)));
    rows.push(row("CBSE", { evidenceLocator: locator, minimumPercent: pct, subjects, notesEn: holistic ? NOTE_US_HOLISTIC.en : null, notesAr: holistic ? NOTE_US_HOLISTIC.ar : null }));
    if (!holistic && (c === "GB" || c === "SG" || c === "AU") && t <= 2) rows.push(row("ISC", { evidenceLocator: locator, minimumPercent: pct, subjects }));
  }

  // Jordanian Tawjihi: Jordan and UAE universities.
  if (c === "JO" || c === "AE") {
    const pct = g === "MED" || g === "DENT" ? 85 : g === "PHARM" ? 80 : g.startsWith("ENG") || g === "ARCH" ? 80 : g === "CS" ? 75 : 65;
    const stream = HEALTH.has(g) || g.startsWith("ENG") || ["BIO", "CHEM", "PHYS", "MATH", "SCI", "ARCH"].includes(g) ? "SCIENTIFIC" : g === "CS" ? "SCIENTIFIC|IT" : null;
    rows.push(row("JORDAN_TAWJIHI", { evidenceLocator: "Admission requirements: Tawjihi", minimumPercent: pct, stream, notesEn: c === "JO" ? "Real cut-off averages for the unified admission list change every year and are usually well above the minimum." : null, notesAr: c === "JO" ? "تتغير معدلات القبول الفعلية في قائمة القبول الموحد كل عام وتكون عادة أعلى بكثير من الحد الأدنى." : null }));
  }

  // SABIS: UAE universities and accessible UK universities.
  if (c === "AE" || (c === "GB" && t === 3)) rows.push(row("SABIS", { evidenceLocator: locator, minimumPercent: t === 1 ? 85 : 75, subjects: subjectLines(needs.filter((n) => n.strength !== "advice"), "ADVANCED", () => null) }));

  return rows;
}

// ---------------------------------------------------------------------------------------------
// Build

const slug = (s: string) => s.replace(/_/g, "-");

export function buildPrograms(): ProgramSeed[] {
  const unis = new Map(GLOBAL_UNIVERSITIES.map((u) => [u.key, u]));
  const out: ProgramSeed[] = [];
  const seen = new Set<string>();
  const make = (u: GlobalUniversity, tplKey: string, legacy?: (typeof LEGACY_PROGRAMS)[number]) => {
    const tpl = TEMPLATES[tplKey];
    const g = tpl.group;
    const d = degreeFor(tplKey, g, u);
    const degree = legacy?.degree ?? d.degree;
    const lang = teachingLanguage(g, u, legacy?.key);
    const tuition = tuitionFor(g, u);
    const key = legacy?.key ?? `${slug(u.key)}-${tplKey}`;
    if (seen.has(key)) return;
    seen.add(key);
    const nameAr = g === "MED" || g === "DENT" || g === "VET" || g === "PHARM" ? d.ar : `${d.ar} ${tpl.ar}`;
    const fieldKeys = legacy?.key === "berkeley-eecs-bs" ? ["electrical_engineering", "computer_science", "artificial_intelligence"] : tpl.fieldKeys;
    out.push({
      key,
      uni: u.key,
      name: legacy ? legacy.name : { en: `${tpl.en} ${degree}`, ar: nameAr },
      template: tplKey,
      field: tpl.legacyField,
      fieldKeys,
      degree,
      degreeType: g === "MED" || g === "DENT" || g === "VET" ? "PROFESSIONAL" : degree === "MEng" ? "INTEGRATED_MASTERS" : "BACHELOR",
      durationYears: legacy?.years ?? durationFor(g, degree, u),
      tuitionPerYear: tuition.amount,
      tuitionCurrency: tuition.amount === null ? null : tuition.currency,
      teachingLanguage: lang,
      sourceUrl: legacy?.source && legacy.source.startsWith("https://") && legacy.source.length > 30 ? legacy.source : u.admissionsUrl,
      notes: legacy?.notes ?? null,
      rows: [generalRow(g, u, lang, tplKey), ...curriculumRows(g, u)],
    });
  };
  for (const lp of LEGACY_PROGRAMS) {
    const u = unis.get(lp.uni);
    const tpl = LEGACY_TEMPLATE[lp.key];
    if (u && tpl) {
      make(u, tpl, lp);
      seen.add(`${slug(u.key)}-${tpl}`);
    }
  }
  for (const [uniKey, list] of Object.entries(OFFERS)) {
    const u = unis.get(uniKey);
    if (!u) continue;
    for (const tpl of list.split(/\s+/)) if (TEMPLATES[tpl]) make(u, tpl);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Legacy JSON for the older requirements checker (src/server/pathways/checker.ts)

const LEGACY_CODE: Record<string, string> = {
  mathematics: "MATH",
  calculus: "MATH",
  precalculus: "MATH",
  further_mathematics: "FURTHER_MATH",
  physics: "PHYS",
  chemistry: "CHEM",
  biology: "BIO",
  computer_science: "CS",
  english_language: "ENG",
  english_literature: "ENG_LIT",
  economics: "ECON",
  business: "BUS",
  geography: "GEO",
  history: "HIST",
  psychology: "PSY",
  art: "ART",
  design_technology: "DT",
  french: "FR",
  arabic: "ARAB",
};

const DEADLINES: Record<string, Array<{ kind: string; month: number; day: number }>> = {
  GB: [{ kind: "equal", month: 1, day: 14 }],
  US: [
    { kind: "early", month: 11, day: 1 },
    { kind: "regular", month: 1, day: 1 },
  ],
  CA: [{ kind: "international", month: 1, day: 15 }],
  AE: [{ kind: "regular", month: 6, day: 30 }],
  JO: [{ kind: "unified", month: 8, day: 15 }],
  AU: [{ kind: "international", month: 11, day: 30 }],
  IE: [{ kind: "regular", month: 2, day: 1 }],
  NL: [{ kind: "international", month: 5, day: 1 }],
  DE: [{ kind: "international", month: 7, day: 15 }],
  CH: [{ kind: "international", month: 4, day: 30 }],
  SG: [{ kind: "international", month: 2, day: 23 }],
  HK: [{ kind: "international", month: 1, day: 5 }],
  FR: [{ kind: "international", month: 1, day: 15 }],
  ES: [{ kind: "regular", month: 3, day: 31 }],
};

export function legacyFields(p: ProgramSeed, u: GlobalUniversity) {
  const byCur = (c: SchoolCurriculum) => p.rows.find((r) => r.curriculum === c);
  const general = p.rows.find((r) => r.curriculum === null);
  const subjectMins = (r: RowSeed | undefined) =>
    (r?.subjects ?? []).filter((s) => s.type === "REQUIRED" && s.keys.length === 1 && LEGACY_CODE[s.keys[0]]).map((s) => ({ code: LEGACY_CODE[s.keys[0]], min: s.minimumGrade }));
  const req: Record<string, unknown> = {};
  const oxbridgeOrMed = u.countryCode === "GB" && (u.key === "oxford" || u.key === "cambridge" || p.template === "med" || p.template === "dent");
  req.route = { via: u.applyVia, deadlines: oxbridgeOrMed ? [{ kind: "oxbridge", month: 10, day: 15 }] : (DEADLINES[u.countryCode] ?? []), url: u.admissionsUrl };
  const adm = (general?.tests ?? []).filter((t) => t.policy === "REQUIRED" && !["SAT", "ACT"].includes(t.test)).map((t) => t.test);
  if (adm.length) req.admissionsTests = adm;
  const br = byCur("BRITISH");
  if (br) req.BRITISH = { grades: br.gradeProfile ?? undefined, subjects: subjectMins(br), notesEn: br.notesEn ?? undefined, notesAr: br.notesAr ?? undefined };
  const ib = byCur("IB");
  if (ib) req.IB = { points: ib.minimumPoints ?? undefined, hl: subjectMins(ib), notesEn: ib.notesEn ?? undefined, notesAr: ib.notesAr ?? undefined };
  const am = byCur("AMERICAN");
  if (am) {
    const sat = (general?.tests ?? []).concat(am.tests).find((t) => t.test === "SAT");
    const act = (general?.tests ?? []).concat(am.tests).find((t) => t.test === "ACT");
    const policy = sat?.policy === "REQUIRED" ? "REQUIRED" : sat?.policy === "BLIND" ? "BLIND" : "OPTIONAL";
    req.AMERICAN = { gpa: am.minimumGPA ?? undefined, testPolicy: policy, sat: sat?.minScore ?? undefined, act: act?.minScore ?? undefined, ap: am.subjects.some((s) => s.minimumLevel === "ADVANCED" && s.type === "REQUIRED") ? subjectMins(am) : [], notesEn: am.notesEn ?? undefined, notesAr: am.notesAr ?? undefined };
  }
  const moe = byCur("UAE_MOE");
  if (moe && moe.minimumPercent) req.UAE_MOE = { average: moe.minimumPercent, streams: moe.stream?.split("|"), emsat: moe.tests.filter((t) => t.test.startsWith("EMSAT") && t.policy === "REQUIRED").map((t) => ({ kind: t.test, min: t.minScore })) };
  const taw = byCur("JORDAN_TAWJIHI");
  if (taw) req.JORDAN_TAWJIHI = { average: taw.minimumPercent ?? undefined, streams: taw.stream?.split("|"), notesEn: taw.notesEn ?? undefined, notesAr: taw.notesAr ?? undefined };
  const base = br ?? p.rows.find((r) => r.curriculum !== null);
  const requiredSubjects = [...new Set(subjectMins(base).map((s) => s.code))];
  const recommendedSubjects = [...new Set((base?.subjects ?? []).filter((s) => s.type === "RECOMMENDED" || s.type === "PREFERRED").flatMap((s) => s.keys.map((k) => LEGACY_CODE[k]).filter(Boolean)))].filter((c) => !requiredSubjects.includes(c));
  const lang = general?.languages ?? [];
  const englishReq = lang.some((l) => ["IELTS", "TOEFL", "EMSAT_ENGLISH"].includes(l.test))
    ? {
        ielts: lang.find((l) => l.test === "IELTS")?.minOverall,
        ieltsMinBand: lang.find((l) => l.test === "IELTS")?.minComponent ?? undefined,
        toefl: lang.find((l) => l.test === "TOEFL")?.minOverall,
        emsatEnglish: lang.find((l) => l.test === "EMSAT_ENGLISH")?.minOverall,
      }
    : null;
  return { requirements: JSON.parse(JSON.stringify(req)) as object, requiredSubjects, recommendedSubjects, englishReq: englishReq ? (JSON.parse(JSON.stringify(englishReq)) as object) : null };
}
