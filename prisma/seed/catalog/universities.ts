// Global university catalog: the former per-school lists (prisma/seed/data/universities.ts and the
// pathways additions) plus more institutions in the UK, US, Canada, Australia, Ireland, the
// Netherlands, Germany, Singapore, Hong Kong, the UAE and Jordan. Facts are indicative.
import { UNIVERSITIES } from "../data/universities";
import { EXTRA_UNIVERSITIES, UNIVERSITY_ROUTES } from "../academics/pathways-data";

type Bi = { en: string; ar: string };
export type GlobalUniversity = {
  key: string;
  name: Bi;
  countryCode: string;
  city: Bi;
  worldRank: number | null;
  acceptanceRate: number | null;
  minAverage: number | null;
  programs: string[];
  website: string;
  deadlineMonth: number | null;
  system: string;
  applyVia: string;
  /** Official undergraduate admissions page. */
  admissionsUrl: string;
  /** 1 very selective, 2 selective, 3 broadly accessible. Drives example requirement values. */
  tier: 1 | 2 | 3;
};

const COUNTRY_ROUTE: Record<string, { system: string; applyVia: string }> = {
  GB: { system: "UK", applyVia: "UCAS" },
  US: { system: "US", applyVia: "COMMON_APP" },
  CA: { system: "CA", applyVia: "DIRECT" },
  AE: { system: "AE", applyVia: "DIRECT" },
  JO: { system: "JO", applyVia: "JORDAN_UNIFIED" },
  AU: { system: "AU", applyVia: "DIRECT" },
  IE: { system: "IE", applyVia: "CAO" },
  NL: { system: "NL", applyVia: "STUDIELINK" },
  DE: { system: "DE", applyVia: "UNI_ASSIST" },
  SG: { system: "SG", applyVia: "DIRECT" },
  HK: { system: "HK", applyVia: "DIRECT" },
  CH: { system: "CH", applyVia: "DIRECT" },
  FR: { system: "FR", applyVia: "DIRECT" },
  ES: { system: "ES", applyVia: "DIRECT" },
};

const ADMISSIONS: Record<string, string> = {
  khalifa_university: "https://www.ku.ac.ae/undergraduate-admissions",
  mbzuai: "https://mbzuai.ac.ae/study/admission-process/",
  uae_university: "https://www.uaeu.ac.ae/en/admission/",
  american_university_sharjah: "https://www.aus.edu/admissions",
  nyu_abu_dhabi: "https://nyuad.nyu.edu/en/admissions.html",
  university_of_sharjah: "https://www.sharjah.ac.ae/en/Admission",
  zayed_university: "https://www.zu.ac.ae/main/en/admission/",
  heriot_watt_dubai: "https://www.hw.ac.uk/dubai/study/undergraduate.htm",
  birmingham_dubai: "https://www.birmingham.ac.uk/dubai/undergraduate",
  middlesex_dubai: "https://www.mdx.ac.ae/study-with-us/undergraduate",
  sorbonne_abu_dhabi: "https://www.sorbonne.ae/admissions/",
  rit_dubai: "https://www.rit.edu/dubai/admissions",
  wollongong_dubai: "https://www.uowdubai.ac.ae/admissions",
  abu_dhabi_university: "https://www.adu.ac.ae/admissions",
  oxford: "https://www.ox.ac.uk/admissions/undergraduate",
  cambridge: "https://www.undergraduate.study.cam.ac.uk/",
  imperial_college_london: "https://www.imperial.ac.uk/study/apply/undergraduate/",
  ucl: "https://www.ucl.ac.uk/prospective-students/undergraduate/",
  kings_college_london: "https://www.kcl.ac.uk/study/undergraduate",
  edinburgh: "https://www.ed.ac.uk/studying/undergraduate",
  manchester: "https://www.manchester.ac.uk/study/undergraduate/",
  lse: "https://www.lse.ac.uk/study-at-lse/undergraduate",
  warwick: "https://warwick.ac.uk/study/undergraduate/",
  bristol: "https://www.bristol.ac.uk/study/undergraduate/",
  glasgow: "https://www.gla.ac.uk/undergraduate/",
  mit: "https://mitadmissions.org/",
  stanford: "https://admission.stanford.edu/",
  harvard: "https://college.harvard.edu/admissions",
  carnegie_mellon: "https://admission.enrollment.cmu.edu/",
  uc_berkeley: "https://admissions.berkeley.edu/",
  cornell: "https://admissions.cornell.edu/",
  johns_hopkins: "https://apply.jhu.edu/",
  university_of_michigan: "https://admissions.umich.edu/",
  georgia_tech: "https://admission.gatech.edu/",
  uiuc: "https://www.admissions.illinois.edu/",
  purdue: "https://admissions.purdue.edu/",
  university_of_toronto: "https://future.utoronto.ca/",
  mcgill: "https://www.mcgill.ca/undergraduate-admissions/",
  ubc: "https://you.ubc.ca/",
  waterloo: "https://uwaterloo.ca/future-students/",
  mcmaster: "https://future.mcmaster.ca/",
  university_of_alberta: "https://www.ualberta.ca/en/admissions/",
  eth_zurich: "https://ethz.ch/en/studies/registration-application/bachelor.html",
  epfl: "https://www.epfl.ch/education/admission/",
  tu_delft: "https://www.tudelft.nl/en/education/admission-and-application",
  university_of_amsterdam: "https://www.uva.nl/en/education/bachelor-s/bachelor-s.html",
  tu_munich: "https://www.tum.de/en/studies/application",
  trinity_college_dublin: "https://www.tcd.ie/study/undergraduate/",
  sciences_po: "https://www.sciencespo.fr/admissions/en/",
  ie_university: "https://www.ie.edu/university/admissions/",
  university_of_jordan: "https://admreg.ju.edu.jo/",
  just: "https://www.just.edu.jo/",
  psut: "https://www.psut.edu.jo/en/admission",
  gju: "https://www.gju.edu.jo/",
  yarmouk: "https://www.yu.edu.jo/",
  unimelb: "https://study.unimelb.edu.au/",
};

const TIER1 = new Set(["oxford", "cambridge", "imperial_college_london", "ucl", "lse", "mit", "stanford", "harvard", "carnegie_mellon", "uc_berkeley", "cornell", "johns_hopkins", "eth_zurich", "epfl", "columbia", "princeton", "nus", "mbzuai", "nyu_abu_dhabi", "university_of_toronto", "waterloo"]);
const TIER3 = new Set(["middlesex_dubai", "wollongong_dubai", "abu_dhabi_university", "zayed_university", "university_of_sharjah", "rit_dubai", "heriot_watt_dubai", "yarmouk", "university_of_alberta", "aud", "sorbonne_abu_dhabi", "ie_university"]);
const tierOf = (key: string, rank: number | null): 1 | 2 | 3 => (TIER1.has(key) ? 1 : TIER3.has(key) ? 3 : rank !== null && rank <= 60 ? 2 : rank === null || rank > 300 ? 3 : 2);

const bi = (en: string, ar: string): Bi => ({ en, ar });
type NewUni = [key: string, name: Bi, country: string, city: Bi, rank: number | null, acceptance: number | null, website: string, deadlineMonth: number | null, admissionsUrl: string, applyVia?: string];

const NEW_UNIVERSITIES: NewUni[] = [
  // United Kingdom
  ["durham", bi("Durham University", "جامعة دورهام"), "GB", bi("Durham", "دورهام"), 89, 40, "durham.ac.uk", 1, "https://www.durham.ac.uk/study/undergraduate/"],
  ["st_andrews", bi("University of St Andrews", "جامعة سانت أندروز"), "GB", bi("St Andrews", "سانت أندروز"), 104, 35, "st-andrews.ac.uk", 1, "https://www.st-andrews.ac.uk/subjects/"],
  ["leeds", bi("University of Leeds", "جامعة ليدز"), "GB", bi("Leeds", "ليدز"), 82, 60, "leeds.ac.uk", 1, "https://www.leeds.ac.uk/undergraduate"],
  ["southampton", bi("University of Southampton", "جامعة ساوثهامبتون"), "GB", bi("Southampton", "ساوثهامبتون"), 80, 65, "southampton.ac.uk", 1, "https://www.southampton.ac.uk/courses/undergraduate"],
  ["nottingham", bi("University of Nottingham", "جامعة نوتنغهام"), "GB", bi("Nottingham", "نوتنغهام"), 108, 70, "nottingham.ac.uk", 1, "https://www.nottingham.ac.uk/ugstudy/"],
  ["birmingham", bi("University of Birmingham", "جامعة برمنغهام"), "GB", bi("Birmingham", "برمنغهام"), 76, 65, "birmingham.ac.uk", 1, "https://www.birmingham.ac.uk/undergraduate"],
  ["bath", bi("University of Bath", "جامعة باث"), "GB", bi("Bath", "باث"), 150, 60, "bath.ac.uk", 1, "https://www.bath.ac.uk/study/undergraduate/"],
  ["exeter", bi("University of Exeter", "جامعة إكستر"), "GB", bi("Exeter", "إكستر"), 169, 75, "exeter.ac.uk", 1, "https://www.exeter.ac.uk/study/undergraduate/"],
  ["sheffield", bi("University of Sheffield", "جامعة شيفيلد"), "GB", bi("Sheffield", "شيفيلد"), 105, 75, "sheffield.ac.uk", 1, "https://www.sheffield.ac.uk/undergraduate"],
  ["qmul", bi("Queen Mary University of London", "جامعة كوين ماري في لندن"), "GB", bi("London", "لندن"), 120, 65, "qmul.ac.uk", 1, "https://www.qmul.ac.uk/undergraduate/"],
  // United States
  ["columbia", bi("Columbia University", "جامعة كولومبيا"), "US", bi("New York", "نيويورك"), 34, 4, "columbia.edu", 1, "https://undergrad.admissions.columbia.edu/"],
  ["ucla", bi("University of California, Los Angeles", "جامعة كاليفورنيا في لوس أنجلوس"), "US", bi("Los Angeles", "لوس أنجلوس"), 42, 9, "ucla.edu", 11, "https://admission.ucla.edu/", "UC_APP"],
  ["ut_austin", bi("The University of Texas at Austin", "جامعة تكساس في أوستن"), "US", bi("Austin", "أوستن"), 66, 29, "utexas.edu", 12, "https://admissions.utexas.edu/"],
  ["uw_seattle", bi("University of Washington", "جامعة واشنطن"), "US", bi("Seattle", "سياتل"), 81, 43, "washington.edu", 11, "https://admit.washington.edu/"],
  ["northeastern", bi("Northeastern University", "جامعة نورث إيسترن"), "US", bi("Boston", "بوسطن"), 373, 6, "northeastern.edu", 1, "https://admissions.northeastern.edu/"],
  ["nyu", bi("New York University", "جامعة نيويورك"), "US", bi("New York", "نيويورك"), 43, 9, "nyu.edu", 1, "https://www.nyu.edu/admissions/undergraduate-admissions.html"],
  // Canada
  ["queens_university", bi("Queen's University", "جامعة كوينز"), "CA", bi("Kingston", "كينغستون"), 193, 45, "queensu.ca", 2, "https://www.queensu.ca/admission/", "OUAC"],
  ["western", bi("Western University", "جامعة ويسترن"), "CA", bi("London, Ontario", "لندن، أونتاريو"), 114, 55, "uwo.ca", 2, "https://welcome.uwo.ca/", "OUAC"],
  // Australia
  ["unsw", bi("UNSW Sydney", "جامعة نيو ساوث ويلز"), "AU", bi("Sydney", "سيدني"), 19, null, "unsw.edu.au", null, "https://www.unsw.edu.au/study/undergraduate"],
  ["usyd", bi("The University of Sydney", "جامعة سيدني"), "AU", bi("Sydney", "سيدني"), 18, null, "sydney.edu.au", null, "https://www.sydney.edu.au/study/"],
  ["monash", bi("Monash University", "جامعة موناش"), "AU", bi("Melbourne", "ملبورن"), 37, null, "monash.edu", null, "https://www.monash.edu/study"],
  ["anu", bi("The Australian National University", "الجامعة الوطنية الأسترالية"), "AU", bi("Canberra", "كانبرا"), 32, null, "anu.edu.au", null, "https://study.anu.edu.au/"],
  ["uq", bi("The University of Queensland", "جامعة كوينزلاند"), "AU", bi("Brisbane", "بريزبن"), 42, null, "uq.edu.au", null, "https://study.uq.edu.au/"],
  // Ireland
  ["ucd", bi("University College Dublin", "كلية دبلن الجامعية"), "IE", bi("Dublin", "دبلن"), 118, null, "ucd.ie", 2, "https://www.ucd.ie/global/", "DIRECT"],
  ["rcsi", bi("RCSI University of Medicine and Health Sciences", "جامعة RCSI للطب والعلوم الصحية"), "IE", bi("Dublin", "دبلن"), null, null, "rcsi.com", 2, "https://www.rcsi.com/dublin/undergraduate", "DIRECT"],
  // Netherlands
  ["tu_eindhoven", bi("Eindhoven University of Technology", "جامعة أيندهوفن للتكنولوجيا"), "NL", bi("Eindhoven", "أيندهوفن"), 124, null, "tue.nl", 1, "https://www.tue.nl/en/education/become-a-tue-student"],
  ["leiden", bi("Leiden University", "جامعة لايدن"), "NL", bi("Leiden", "لايدن"), 126, null, "universiteitleiden.nl", 1, "https://www.universiteitleiden.nl/en/education/bachelors"],
  // Germany
  ["rwth_aachen", bi("RWTH Aachen University", "جامعة آخن التقنية"), "DE", bi("Aachen", "آخن"), 99, null, "rwth-aachen.de", 7, "https://www.rwth-aachen.de/go/id/aej/?lidx=1"],
  ["lmu_munich", bi("LMU Munich", "جامعة لودفيغ ماكسيميليان في ميونخ"), "DE", bi("Munich", "ميونخ"), 59, null, "lmu.de", 7, "https://www.lmu.de/en/study/"],
  ["kit", bi("Karlsruhe Institute of Technology", "معهد كارلسروه للتكنولوجيا"), "DE", bi("Karlsruhe", "كارلسروه"), 102, null, "kit.edu", 7, "https://www.kit.edu/english/studies.php"],
  // Singapore
  ["nus", bi("National University of Singapore", "جامعة سنغافورة الوطنية"), "SG", bi("Singapore", "سنغافورة"), 8, 5, "nus.edu.sg", 2, "https://www.nus.edu.sg/oam/"],
  ["ntu", bi("Nanyang Technological University", "جامعة نانيانغ التكنولوجية"), "SG", bi("Singapore", "سنغافورة"), 15, 10, "ntu.edu.sg", 2, "https://www.ntu.edu.sg/admissions/undergraduate"],
  // Hong Kong
  ["hku", bi("The University of Hong Kong", "جامعة هونغ كونغ"), "HK", bi("Hong Kong", "هونغ كونغ"), 17, 10, "hku.hk", 1, "https://admissions.hku.hk/"],
  ["hkust", bi("The Hong Kong University of Science and Technology", "جامعة هونغ كونغ للعلوم والتكنولوجيا"), "HK", bi("Hong Kong", "هونغ كونغ"), 47, 15, "hkust.edu.hk", 1, "https://join.hkust.edu.hk/"],
  ["cuhk", bi("The Chinese University of Hong Kong", "الجامعة الصينية في هونغ كونغ"), "HK", bi("Hong Kong", "هونغ كونغ"), 36, 15, "cuhk.edu.hk", 1, "https://admission.cuhk.edu.hk/"],
  // United Arab Emirates
  ["aud", bi("American University in Dubai", "الجامعة الأمريكية في دبي"), "AE", bi("Dubai", "دبي"), null, 70, "aud.edu", 8, "https://www.aud.edu/admissions/"],
];

const FROM_CAREER: GlobalUniversity[] = UNIVERSITIES.map((u) => {
  const route = UNIVERSITY_ROUTES[u.key] ?? COUNTRY_ROUTE[u.countryCode] ?? { system: u.countryCode, applyVia: "DIRECT" };
  return {
    key: u.key,
    name: u.name,
    countryCode: u.countryCode,
    city: u.city,
    worldRank: u.worldRank ?? null,
    acceptanceRate: u.acceptanceRate ?? null,
    minAverage: u.minAverage ?? null,
    programs: u.programs,
    website: u.website,
    deadlineMonth: u.deadlineMonth,
    system: route.system,
    applyVia: route.applyVia,
    admissionsUrl: ADMISSIONS[u.key] ?? `https://www.${u.website}/`,
    tier: tierOf(u.key, u.worldRank ?? null),
  };
});

const FROM_PATHWAYS: GlobalUniversity[] = EXTRA_UNIVERSITIES.map((u) => ({
  key: u.key,
  name: u.name,
  countryCode: u.countryCode,
  city: u.city,
  worldRank: u.key === "unimelb" ? 13 : u.key === "university_of_jordan" ? 368 : null,
  acceptanceRate: null,
  minAverage: null,
  programs: u.programs,
  website: u.website,
  deadlineMonth: u.deadlineMonth,
  system: u.system,
  applyVia: u.applyVia,
  admissionsUrl: ADMISSIONS[u.key] ?? `https://www.${u.website}/`,
  tier: tierOf(u.key, u.key === "unimelb" ? 13 : null) === 3 && u.countryCode === "JO" && u.key !== "yarmouk" ? 2 : tierOf(u.key, u.key === "unimelb" ? 13 : null),
}));

const FROM_NEW: GlobalUniversity[] = NEW_UNIVERSITIES.map(([key, name, countryCode, city, rank, acceptance, website, deadlineMonth, admissionsUrl, applyVia]) => {
  const route = COUNTRY_ROUTE[countryCode];
  return { key, name, countryCode, city, worldRank: rank, acceptanceRate: acceptance, minAverage: null, programs: [], website, deadlineMonth, system: route.system, applyVia: applyVia ?? route.applyVia, admissionsUrl, tier: tierOf(key, rank) };
});

export const GLOBAL_UNIVERSITIES: GlobalUniversity[] = [...FROM_CAREER, ...FROM_PATHWAYS, ...FROM_NEW];
