// Standard curriculum courses (global) and how each maps to canonical subjects.
// Mapping notation: "subject:LEVEL:rigor" with LEVEL F (foundation), S (standard), A (advanced), H (higher).
// Levels are comparable across curricula only as a coarse guide: A-level, AP, CBSE/ISC Class 12,
// UAE MoE Advanced and Tawjihi scientific subjects are ADVANCED; IB Higher Level is HIGHER.
import type { SchoolCurriculum, SubjectLevel } from "@prisma/client";
import { scaleFor } from "@/server/pathway-engine/grade-scales";

export type CourseSeed = {
  curriculum: SchoolCurriculum;
  code: string;
  en: string;
  ar: string;
  qualification: string;
  gradeLevel: number | null;
  gradeScale: string;
  mappings: Array<{ key: string; level: SubjectLevel; rigor: number }>;
};

const LV: Record<string, SubjectLevel> = { F: "FOUNDATION", S: "STANDARD", A: "ADVANCED", H: "HIGHER" };

function list(curriculum: SchoolCurriculum, rows: Array<[string, string, string, string, number | null, string]>): CourseSeed[] {
  return rows.map(([code, en, ar, qualification, gradeLevel, maps]) => ({
    curriculum,
    code,
    en,
    ar,
    qualification,
    gradeLevel,
    gradeScale: scaleFor(curriculum, qualification),
    mappings: maps.split(/\s+/).map((m) => {
      const [key, lv, rigor] = m.split(":");
      return { key, level: LV[lv], rigor: Number(rigor) };
    }),
  }));
}

const AMERICAN = list("AMERICAN", [
  ["US_ENG9", "English 9", "اللغة الإنجليزية 9", "CORE", 9, "english_language:S:2 english_literature:S:2"],
  ["US_ENG10", "English 10", "اللغة الإنجليزية 10", "CORE", 10, "english_language:S:2 english_literature:S:2"],
  ["US_ENG11", "English 11", "اللغة الإنجليزية 11", "CORE", 11, "english_language:S:3 english_literature:S:3"],
  ["US_ENG12", "English 12", "اللغة الإنجليزية 12", "CORE", 12, "english_language:S:3 english_literature:S:3"],
  ["AP_ENG_LANG", "AP English Language and Composition", "اللغة الإنجليزية والتأليف (AP)", "AP", null, "english_language:A:5"],
  ["AP_ENG_LIT", "AP English Literature and Composition", "الأدب الإنجليزي والتأليف (AP)", "AP", null, "english_literature:A:5 english_language:A:4"],
  ["US_ALG1", "Algebra I", "الجبر 1", "CORE", 9, "mathematics:S:2 algebra:S:2"],
  ["US_ALG1_H", "Algebra I Honors", "الجبر 1 (مستوى الشرف)", "HONORS", 9, "mathematics:S:3 algebra:S:3"],
  ["US_GEOM", "Geometry", "الهندسة", "CORE", 10, "mathematics:S:2 geometry:S:2"],
  ["US_GEOM_H", "Geometry Honors", "الهندسة (مستوى الشرف)", "HONORS", 10, "mathematics:S:3 geometry:S:3"],
  ["US_ALG2", "Algebra II", "الجبر 2", "CORE", 11, "mathematics:S:3 algebra:S:3"],
  ["US_ALG2_H", "Algebra II Honors", "الجبر 2 (مستوى الشرف)", "HONORS", 10, "mathematics:S:3 algebra:S:4"],
  ["US_PRECALC", "Precalculus", "مبادئ التفاضل والتكامل", "CORE", 12, "mathematics:S:3 precalculus:S:3"],
  ["US_PRECALC_H", "Precalculus Honors", "مبادئ التفاضل والتكامل (مستوى الشرف)", "HONORS", 11, "mathematics:S:4 precalculus:S:4"],
  ["US_CALC", "Calculus", "التفاضل والتكامل", "CORE", 12, "mathematics:S:4 calculus:S:4"],
  ["AP_CALC_AB", "AP Calculus AB", "التفاضل والتكامل AB (AP)", "AP", null, "mathematics:A:4 calculus:A:4"],
  ["AP_CALC_BC", "AP Calculus BC", "التفاضل والتكامل BC (AP)", "AP", null, "mathematics:A:5 calculus:A:5"],
  ["AP_STATS", "AP Statistics", "الإحصاء (AP)", "AP", null, "mathematics:A:4 statistics:A:4"],
  ["US_BIO", "Biology", "الأحياء", "CORE", 9, "science:S:2 biology:S:2"],
  ["US_BIO_H", "Biology Honors", "الأحياء (مستوى الشرف)", "HONORS", 9, "science:S:3 biology:S:3"],
  ["US_CHEM", "Chemistry", "الكيمياء", "CORE", 10, "science:S:2 chemistry:S:2"],
  ["US_CHEM_H", "Chemistry Honors", "الكيمياء (مستوى الشرف)", "HONORS", 10, "science:S:3 chemistry:S:3"],
  ["US_PHYS", "Physics", "الفيزياء", "CORE", 11, "science:S:2 physics:S:2"],
  ["US_PHYS_H", "Physics Honors", "الفيزياء (مستوى الشرف)", "HONORS", 11, "science:S:3 physics:S:3"],
  ["AP_PHYS_1", "AP Physics 1", "الفيزياء 1 (AP)", "AP", null, "science:A:4 physics:A:4"],
  ["AP_PHYS_2", "AP Physics 2", "الفيزياء 2 (AP)", "AP", null, "science:A:4 physics:A:4"],
  ["AP_PHYS_C_MECH", "AP Physics C: Mechanics", "الفيزياء C: الميكانيكا (AP)", "AP", null, "science:A:5 physics:A:5 calculus:A:3"],
  ["AP_CHEM", "AP Chemistry", "الكيمياء (AP)", "AP", null, "science:A:5 chemistry:A:5"],
  ["AP_BIO", "AP Biology", "الأحياء (AP)", "AP", null, "science:A:5 biology:A:5"],
  ["AP_ENV_SCI", "AP Environmental Science", "علوم البيئة (AP)", "AP", null, "science:A:3 environmental_science:A:3"],
  ["US_INTRO_CS", "Introduction to Computer Science", "مقدمة في علوم الحاسوب", "CORE", 9, "computer_science:S:2"],
  ["AP_CSP", "AP Computer Science Principles", "مبادئ علوم الحاسوب (AP)", "AP", null, "computer_science:A:3"],
  ["AP_CSA", "AP Computer Science A", "علوم الحاسوب A (AP)", "AP", null, "computer_science:A:5"],
  ["US_ARABIC", "Arabic", "اللغة العربية", "CORE", null, "arabic:S:3"],
  ["US_ISLAMIC", "Islamic Studies", "التربية الإسلامية", "CORE", null, "islamic_studies:S:2"],
  ["US_UAE_SS", "UAE Social Studies", "الدراسات الاجتماعية الإماراتية", "CORE", null, "uae_social_studies:S:2 social_studies:S:2"],
  ["US_WORLD_HIST", "World History", "تاريخ العالم", "CORE", 10, "history:S:2 social_studies:S:2"],
  ["AP_WORLD_HIST", "AP World History: Modern", "تاريخ العالم الحديث (AP)", "AP", null, "history:A:4 social_studies:A:4"],
  ["US_ECON", "Economics", "الاقتصاد", "CORE", 12, "economics:S:2 social_studies:S:2"],
  ["AP_MACRO", "AP Macroeconomics", "الاقتصاد الكلي (AP)", "AP", null, "economics:A:4"],
  ["AP_PSYCH", "AP Psychology", "علم النفس (AP)", "AP", null, "psychology:A:3"],
  ["US_BUSINESS", "Business and Entrepreneurship", "إدارة الأعمال وريادة الأعمال", "ELECTIVE", null, "business:S:2 entrepreneurship:S:2"],
  ["US_ART", "Studio Art", "الفنون البصرية", "ELECTIVE", null, "art:S:2"],
  ["US_ROBOTICS", "Robotics and Engineering Design", "الروبوتات والتصميم الهندسي", "ELECTIVE", null, "robotics:S:3 engineering_science:S:3 design_technology:S:2"],
  ["US_FRENCH", "French", "اللغة الفرنسية", "CORE", null, "french:S:2 second_language:S:2"],
  ["US_PE", "Physical Education", "التربية الرياضية", "CORE", null, "physical_education:S:1"],
]);

const BRITISH = list("BRITISH", [
  ["IGCSE_ENG", "IGCSE English Language", "اللغة الإنجليزية IGCSE", "IGCSE", 10, "english_language:S:3"],
  ["IGCSE_ENG_LIT", "IGCSE English Literature", "الأدب الإنجليزي IGCSE", "IGCSE", 10, "english_literature:S:3"],
  ["IGCSE_MATH", "IGCSE Mathematics", "الرياضيات IGCSE", "IGCSE", 10, "mathematics:S:3"],
  ["IGCSE_ADD_MATH", "IGCSE Additional Mathematics", "الرياضيات الإضافية IGCSE", "IGCSE", 10, "mathematics:S:4 further_mathematics:S:3"],
  ["IGCSE_PHYS", "IGCSE Physics", "الفيزياء IGCSE", "IGCSE", 10, "science:S:3 physics:S:3"],
  ["IGCSE_CHEM", "IGCSE Chemistry", "الكيمياء IGCSE", "IGCSE", 10, "science:S:3 chemistry:S:3"],
  ["IGCSE_BIO", "IGCSE Biology", "الأحياء IGCSE", "IGCSE", 10, "science:S:3 biology:S:3"],
  ["IGCSE_COMB_SCI", "IGCSE Combined Science", "العلوم المتكاملة IGCSE", "IGCSE", 10, "science:S:2 combined_science:S:2 physics:S:2 chemistry:S:2 biology:S:2"],
  ["IGCSE_CS", "IGCSE Computer Science", "علوم الحاسوب IGCSE", "IGCSE", 10, "computer_science:S:3"],
  ["IGCSE_ICT", "IGCSE ICT", "تقنية المعلومات IGCSE", "IGCSE", 10, "information_technology:S:2 computer_science:S:1"],
  ["IGCSE_ECON", "IGCSE Economics", "الاقتصاد IGCSE", "IGCSE", 10, "economics:S:3"],
  ["IGCSE_BUS", "IGCSE Business Studies", "إدارة الأعمال IGCSE", "IGCSE", 10, "business:S:3"],
  ["IGCSE_GEO", "IGCSE Geography", "الجغرافيا IGCSE", "IGCSE", 10, "geography:S:3 social_studies:S:2"],
  ["IGCSE_HIST", "IGCSE History", "التاريخ IGCSE", "IGCSE", 10, "history:S:3 social_studies:S:2"],
  ["IGCSE_ARABIC", "IGCSE Arabic First Language", "اللغة العربية لغة أولى IGCSE", "IGCSE", 10, "arabic:S:3"],
  ["IGCSE_FRENCH", "IGCSE French", "اللغة الفرنسية IGCSE", "IGCSE", 10, "french:S:3 second_language:S:3"],
  ["IGCSE_ART", "IGCSE Art and Design", "الفنون والتصميم IGCSE", "IGCSE", 10, "art:S:3"],
  ["IGCSE_DT", "IGCSE Design and Technology", "التصميم والتكنولوجيا IGCSE", "IGCSE", 10, "design_technology:S:3"],
  ["GCSE_MATH", "GCSE Mathematics", "الرياضيات GCSE", "GCSE", 10, "mathematics:S:3"],
  ["GCSE_ENG", "GCSE English Language", "اللغة الإنجليزية GCSE", "GCSE", 10, "english_language:S:3"],
  ["GCSE_PHYS", "GCSE Physics", "الفيزياء GCSE", "GCSE", 10, "science:S:3 physics:S:3"],
  ["GCSE_CHEM", "GCSE Chemistry", "الكيمياء GCSE", "GCSE", 10, "science:S:3 chemistry:S:3"],
  ["GCSE_BIO", "GCSE Biology", "الأحياء GCSE", "GCSE", 10, "science:S:3 biology:S:3"],
  ["GCSE_CS", "GCSE Computer Science", "علوم الحاسوب GCSE", "GCSE", 10, "computer_science:S:3"],
  ["AS_MATH", "AS Mathematics", "الرياضيات AS", "AS_LEVEL", 11, "mathematics:S:4"],
  ["AS_PHYS", "AS Physics", "الفيزياء AS", "AS_LEVEL", 11, "science:S:4 physics:S:4"],
  ["AS_CHEM", "AS Chemistry", "الكيمياء AS", "AS_LEVEL", 11, "science:S:4 chemistry:S:4"],
  ["AS_BIO", "AS Biology", "الأحياء AS", "AS_LEVEL", 11, "science:S:4 biology:S:4"],
  ["AL_MATH", "A-Level Mathematics", "الرياضيات A-Level", "A_LEVEL", 12, "mathematics:A:5 calculus:A:4 statistics:A:3"],
  ["AL_FURTHER_MATH", "A-Level Further Mathematics", "الرياضيات الإضافية A-Level", "A_LEVEL", 12, "further_mathematics:A:5 mathematics:A:5"],
  ["AL_PHYS", "A-Level Physics", "الفيزياء A-Level", "A_LEVEL", 12, "science:A:5 physics:A:5"],
  ["AL_CHEM", "A-Level Chemistry", "الكيمياء A-Level", "A_LEVEL", 12, "science:A:5 chemistry:A:5"],
  ["AL_BIO", "A-Level Biology", "الأحياء A-Level", "A_LEVEL", 12, "science:A:5 biology:A:5"],
  ["AL_CS", "A-Level Computer Science", "علوم الحاسوب A-Level", "A_LEVEL", 12, "computer_science:A:5"],
  ["AL_ECON", "A-Level Economics", "الاقتصاد A-Level", "A_LEVEL", 12, "economics:A:5"],
  ["AL_BUS", "A-Level Business", "إدارة الأعمال A-Level", "A_LEVEL", 12, "business:A:4"],
  ["AL_PSYCH", "A-Level Psychology", "علم النفس A-Level", "A_LEVEL", 12, "psychology:A:4"],
  ["AL_ENG_LIT", "A-Level English Literature", "الأدب الإنجليزي A-Level", "A_LEVEL", 12, "english_literature:A:5 english_language:A:4"],
  ["AL_HIST", "A-Level History", "التاريخ A-Level", "A_LEVEL", 12, "history:A:5"],
  ["AL_GEO", "A-Level Geography", "الجغرافيا A-Level", "A_LEVEL", 12, "geography:A:4"],
  ["AL_ART", "A-Level Art and Design", "الفنون والتصميم A-Level", "A_LEVEL", 12, "art:A:4"],
  ["AL_ARABIC", "A-Level Arabic", "اللغة العربية A-Level", "A_LEVEL", 12, "arabic:A:4"],
  ["AL_FRENCH", "A-Level French", "اللغة الفرنسية A-Level", "A_LEVEL", 12, "french:A:4 second_language:A:4"],
  ["AL_SOCIOLOGY", "A-Level Sociology", "علم الاجتماع A-Level", "A_LEVEL", 12, "sociology:A:4"],
  ["AL_DT", "A-Level Design and Technology", "التصميم والتكنولوجيا A-Level", "A_LEVEL", 12, "design_technology:A:4"],
]);

const IB = list("IB", [
  ["IB_MATH_AA_HL", "IB Mathematics: Analysis and Approaches HL", "الرياضيات: التحليل والمقاربات (مستوى عالٍ)", "HL", 12, "mathematics:H:5 calculus:H:5"],
  ["IB_MATH_AA_SL", "IB Mathematics: Analysis and Approaches SL", "الرياضيات: التحليل والمقاربات (مستوى عادي)", "SL", 12, "mathematics:S:4 calculus:S:3"],
  ["IB_MATH_AI_HL", "IB Mathematics: Applications and Interpretation HL", "الرياضيات: التطبيقات والتفسير (مستوى عالٍ)", "HL", 12, "mathematics:H:4 statistics:H:4"],
  ["IB_MATH_AI_SL", "IB Mathematics: Applications and Interpretation SL", "الرياضيات: التطبيقات والتفسير (مستوى عادي)", "SL", 12, "mathematics:S:3 statistics:S:3"],
  ["IB_PHYS_HL", "IB Physics HL", "الفيزياء (مستوى عالٍ)", "HL", 12, "science:H:5 physics:H:5"],
  ["IB_PHYS_SL", "IB Physics SL", "الفيزياء (مستوى عادي)", "SL", 12, "science:S:4 physics:S:4"],
  ["IB_CHEM_HL", "IB Chemistry HL", "الكيمياء (مستوى عالٍ)", "HL", 12, "science:H:5 chemistry:H:5"],
  ["IB_CHEM_SL", "IB Chemistry SL", "الكيمياء (مستوى عادي)", "SL", 12, "science:S:4 chemistry:S:4"],
  ["IB_BIO_HL", "IB Biology HL", "الأحياء (مستوى عالٍ)", "HL", 12, "science:H:5 biology:H:5"],
  ["IB_BIO_SL", "IB Biology SL", "الأحياء (مستوى عادي)", "SL", 12, "science:S:4 biology:S:4"],
  ["IB_CS_HL", "IB Computer Science HL", "علوم الحاسوب (مستوى عالٍ)", "HL", 12, "computer_science:H:5"],
  ["IB_CS_SL", "IB Computer Science SL", "علوم الحاسوب (مستوى عادي)", "SL", 12, "computer_science:S:4"],
  ["IB_ECON_HL", "IB Economics HL", "الاقتصاد (مستوى عالٍ)", "HL", 12, "economics:H:5"],
  ["IB_ECON_SL", "IB Economics SL", "الاقتصاد (مستوى عادي)", "SL", 12, "economics:S:4"],
  ["IB_BM_HL", "IB Business Management HL", "إدارة الأعمال (مستوى عالٍ)", "HL", 12, "business:H:4"],
  ["IB_PSYCH_HL", "IB Psychology HL", "علم النفس (مستوى عالٍ)", "HL", 12, "psychology:H:4"],
  ["IB_PSYCH_SL", "IB Psychology SL", "علم النفس (مستوى عادي)", "SL", 12, "psychology:S:3"],
  ["IB_ENG_LL_HL", "IB English A: Language and Literature HL", "اللغة الإنجليزية أ: اللغة والأدب (مستوى عالٍ)", "HL", 12, "english_language:H:5 english_literature:H:4"],
  ["IB_ENG_LL_SL", "IB English A: Language and Literature SL", "اللغة الإنجليزية أ: اللغة والأدب (مستوى عادي)", "SL", 12, "english_language:S:4 english_literature:S:3"],
  ["IB_ENG_LIT_HL", "IB English A: Literature HL", "اللغة الإنجليزية أ: الأدب (مستوى عالٍ)", "HL", 12, "english_literature:H:5 english_language:H:4"],
  ["IB_ARABIC_A_SL", "IB Arabic A: Language and Literature SL", "اللغة العربية أ: اللغة والأدب (مستوى عادي)", "SL", 12, "arabic:S:4"],
  ["IB_ARABIC_A_HL", "IB Arabic A: Language and Literature HL", "اللغة العربية أ: اللغة والأدب (مستوى عالٍ)", "HL", 12, "arabic:H:5"],
  ["IB_FRENCH_B_SL", "IB French B SL", "اللغة الفرنسية ب (مستوى عادي)", "SL", 12, "french:S:3 second_language:S:3"],
  ["IB_HIST_HL", "IB History HL", "التاريخ (مستوى عالٍ)", "HL", 12, "history:H:5"],
  ["IB_GEO_SL", "IB Geography SL", "الجغرافيا (مستوى عادي)", "SL", 12, "geography:S:3"],
  ["IB_GP_HL", "IB Global Politics HL", "السياسة العالمية (مستوى عالٍ)", "HL", 12, "global_politics:H:4"],
  ["IB_VA_HL", "IB Visual Arts HL", "الفنون البصرية (مستوى عالٍ)", "HL", 12, "art:H:4"],
  ["IB_DT_SL", "IB Design Technology SL", "تكنولوجيا التصميم (مستوى عادي)", "SL", 12, "design_technology:S:3"],
  ["IB_ESS_SL", "IB Environmental Systems and Societies SL", "النظم البيئية والمجتمعات (مستوى عادي)", "SL", 12, "environmental_science:S:3 science:S:2"],
  ["IB_TOK", "IB Theory of Knowledge", "نظرية المعرفة", "CORE", 12, "theory_of_knowledge:S:3"],
]);

const CBSE = list("CBSE", [
  ["CBSE10_MATH_STD", "CBSE Class 10 Mathematics (Standard)", "الرياضيات للصف العاشر (المستوى القياسي)", "CLASS_10", 10, "mathematics:S:3"],
  ["CBSE10_MATH_BASIC", "CBSE Class 10 Mathematics (Basic)", "الرياضيات للصف العاشر (المستوى الأساسي)", "CLASS_10", 10, "mathematics:F:2"],
  ["CBSE10_SCI", "CBSE Class 10 Science", "العلوم للصف العاشر", "CLASS_10", 10, "science:S:3 physics:S:2 chemistry:S:2 biology:S:2"],
  ["CBSE10_ENG", "CBSE Class 10 English", "اللغة الإنجليزية للصف العاشر", "CLASS_10", 10, "english_language:S:3"],
  ["CBSE10_SST", "CBSE Class 10 Social Science", "العلوم الاجتماعية للصف العاشر", "CLASS_10", 10, "social_studies:S:3 history:S:2 geography:S:2"],
  ["CBSE12_MATH", "CBSE Class 12 Mathematics", "الرياضيات للصف الثاني عشر", "CLASS_12", 12, "mathematics:A:5 calculus:A:4"],
  ["CBSE12_APPLIED_MATH", "CBSE Class 12 Applied Mathematics", "الرياضيات التطبيقية للصف الثاني عشر", "CLASS_12", 12, "applied_mathematics:A:3 mathematics:S:3 statistics:S:3"],
  ["CBSE12_PHYS", "CBSE Class 12 Physics", "الفيزياء للصف الثاني عشر", "CLASS_12", 12, "science:A:5 physics:A:5"],
  ["CBSE12_CHEM", "CBSE Class 12 Chemistry", "الكيمياء للصف الثاني عشر", "CLASS_12", 12, "science:A:5 chemistry:A:5"],
  ["CBSE12_BIO", "CBSE Class 12 Biology", "الأحياء للصف الثاني عشر", "CLASS_12", 12, "science:A:5 biology:A:5"],
  ["CBSE12_CS", "CBSE Class 12 Computer Science", "علوم الحاسوب للصف الثاني عشر", "CLASS_12", 12, "computer_science:A:4"],
  ["CBSE12_IP", "CBSE Class 12 Informatics Practices", "الممارسات المعلوماتية للصف الثاني عشر", "CLASS_12", 12, "information_technology:A:3 computer_science:S:3"],
  ["CBSE12_ENG", "CBSE Class 12 English Core", "اللغة الإنجليزية للصف الثاني عشر", "CLASS_12", 12, "english_language:A:4"],
  ["CBSE12_ECON", "CBSE Class 12 Economics", "الاقتصاد للصف الثاني عشر", "CLASS_12", 12, "economics:A:4"],
  ["CBSE12_ACC", "CBSE Class 12 Accountancy", "المحاسبة للصف الثاني عشر", "CLASS_12", 12, "accounting:A:4 business:S:3"],
  ["CBSE12_BST", "CBSE Class 12 Business Studies", "دراسات الأعمال للصف الثاني عشر", "CLASS_12", 12, "business:A:4"],
  ["CBSE12_PSYCH", "CBSE Class 12 Psychology", "علم النفس للصف الثاني عشر", "CLASS_12", 12, "psychology:A:3"],
]);

const ISC = list("ISC", [
  ["ISC12_MATH", "ISC Class 12 Mathematics", "الرياضيات ISC للصف الثاني عشر", "CLASS_12", 12, "mathematics:A:5 calculus:A:4"],
  ["ISC12_PHYS", "ISC Class 12 Physics", "الفيزياء ISC للصف الثاني عشر", "CLASS_12", 12, "science:A:5 physics:A:5"],
  ["ISC12_CHEM", "ISC Class 12 Chemistry", "الكيمياء ISC للصف الثاني عشر", "CLASS_12", 12, "science:A:5 chemistry:A:5"],
  ["ISC12_BIO", "ISC Class 12 Biology", "الأحياء ISC للصف الثاني عشر", "CLASS_12", 12, "science:A:5 biology:A:5"],
  ["ISC12_CS", "ISC Class 12 Computer Science", "علوم الحاسوب ISC للصف الثاني عشر", "CLASS_12", 12, "computer_science:A:4"],
  ["ISC12_ENG", "ISC Class 12 English", "اللغة الإنجليزية ISC للصف الثاني عشر", "CLASS_12", 12, "english_language:A:4 english_literature:A:4"],
  ["ISC12_ECON", "ISC Class 12 Economics", "الاقتصاد ISC للصف الثاني عشر", "CLASS_12", 12, "economics:A:4"],
  ["ISC12_COMMERCE", "ISC Class 12 Commerce", "التجارة ISC للصف الثاني عشر", "CLASS_12", 12, "business:A:3 accounting:S:3"],
]);

const SABIS = list("SABIS", [
  ["SABIS12_MATH", "SABIS Grade 12 Mathematics", "الرياضيات سابيس للصف الثاني عشر", "GRADE_12", 12, "mathematics:A:4 calculus:A:4"],
  ["SABIS12_PHYS", "SABIS Grade 12 Physics", "الفيزياء سابيس للصف الثاني عشر", "GRADE_12", 12, "science:A:4 physics:A:4"],
  ["SABIS12_CHEM", "SABIS Grade 12 Chemistry", "الكيمياء سابيس للصف الثاني عشر", "GRADE_12", 12, "science:A:4 chemistry:A:4"],
  ["SABIS12_BIO", "SABIS Grade 12 Biology", "الأحياء سابيس للصف الثاني عشر", "GRADE_12", 12, "science:A:4 biology:A:4"],
  ["SABIS12_ENG", "SABIS Grade 12 English", "اللغة الإنجليزية سابيس للصف الثاني عشر", "GRADE_12", 12, "english_language:A:4"],
  ["SABIS12_CS", "SABIS Grade 12 Computer Science", "علوم الحاسوب سابيس للصف الثاني عشر", "GRADE_12", 12, "computer_science:A:3"],
  ["SABIS12_ECON", "SABIS Grade 12 Economics", "الاقتصاد سابيس للصف الثاني عشر", "GRADE_12", 12, "economics:A:3"],
  ["SABIS12_ARABIC", "SABIS Grade 12 Arabic", "اللغة العربية سابيس للصف الثاني عشر", "GRADE_12", 12, "arabic:A:4"],
]);

const UAE_MOE = list("UAE_MOE", [
  ["MOE_ADV_MATH", "Mathematics (Advanced stream)", "الرياضيات (المسار المتقدم)", "ADVANCED", 12, "mathematics:A:4 calculus:A:4"],
  ["MOE_ADV_PHYS", "Physics (Advanced stream)", "الفيزياء (المسار المتقدم)", "ADVANCED", 12, "science:A:4 physics:A:4"],
  ["MOE_ADV_CHEM", "Chemistry (Advanced stream)", "الكيمياء (المسار المتقدم)", "ADVANCED", 12, "science:A:4 chemistry:A:4"],
  ["MOE_ADV_BIO", "Biology (Advanced stream)", "الأحياء (المسار المتقدم)", "ADVANCED", 12, "science:A:4 biology:A:4"],
  ["MOE_ELITE_MATH", "Mathematics (Elite stream)", "الرياضيات (مسار النخبة)", "ELITE", 12, "mathematics:H:5 calculus:H:5"],
  ["MOE_ELITE_PHYS", "Physics (Elite stream)", "الفيزياء (مسار النخبة)", "ELITE", 12, "science:H:5 physics:H:5"],
  ["MOE_ELITE_CHEM", "Chemistry (Elite stream)", "الكيمياء (مسار النخبة)", "ELITE", 12, "science:H:5 chemistry:H:5"],
  ["MOE_ELITE_BIO", "Biology (Elite stream)", "الأحياء (مسار النخبة)", "ELITE", 12, "science:H:5 biology:H:5"],
  ["MOE_GEN_MATH", "Mathematics (General stream)", "الرياضيات (المسار العام)", "GENERAL", 12, "mathematics:S:3"],
  ["MOE_GEN_SCI", "Integrated Science (General stream)", "العلوم المتكاملة (المسار العام)", "GENERAL", 12, "science:S:2 combined_science:S:2"],
  ["MOE_GEN_BUS", "Business (General stream)", "إدارة الأعمال (المسار العام)", "GENERAL", 12, "business:S:3"],
  ["MOE_ENG", "English Language", "اللغة الإنجليزية", "CORE", null, "english_language:S:3"],
  ["MOE_ARABIC", "Arabic Language", "اللغة العربية", "CORE", null, "arabic:A:4"],
  ["MOE_ISLAMIC", "Islamic Education", "التربية الإسلامية", "CORE", null, "islamic_studies:S:3"],
  ["MOE_SOC", "Social Studies and Moral Education", "الدراسات الاجتماعية والتربية الأخلاقية", "CORE", null, "uae_social_studies:S:3 moral_education:S:3"],
  ["MOE_CDI", "Computing, Creative Design and Innovation", "الحوسبة والتصميم الإبداعي والابتكار", "CORE", null, "computer_science:S:3 design_technology:S:2"],
]);

const TAWJIHI = list("JORDAN_TAWJIHI", [
  ["TAW_SCI_MATH", "Mathematics (Scientific stream)", "الرياضيات (الفرع العلمي)", "SCIENTIFIC", 12, "mathematics:A:4 calculus:A:4"],
  ["TAW_SCI_PHYS", "Physics (Scientific stream)", "الفيزياء (الفرع العلمي)", "SCIENTIFIC", 12, "science:A:4 physics:A:4"],
  ["TAW_SCI_CHEM", "Chemistry (Scientific stream)", "الكيمياء (الفرع العلمي)", "SCIENTIFIC", 12, "science:A:4 chemistry:A:4"],
  ["TAW_SCI_BIO", "Biology (Scientific stream)", "الأحياء (الفرع العلمي)", "SCIENTIFIC", 12, "science:A:4 biology:A:4"],
  ["TAW_IT_MATH", "Mathematics (IT stream)", "الرياضيات (فرع تكنولوجيا المعلومات)", "IT", 12, "mathematics:A:3"],
  ["TAW_IT_CS", "Computer Science (IT stream)", "علوم الحاسوب (فرع تكنولوجيا المعلومات)", "IT", 12, "computer_science:A:4"],
  ["TAW_HEALTH_BIO", "Biology (Health stream)", "الأحياء (الفرع الصحي)", "HEALTH", 12, "science:A:4 biology:A:4"],
  ["TAW_HEALTH_CHEM", "Chemistry (Health stream)", "الكيمياء (الفرع الصحي)", "HEALTH", 12, "science:A:3 chemistry:A:3"],
  ["TAW_ENG", "English Language", "اللغة الإنجليزية", "CORE", 12, "english_language:S:3"],
  ["TAW_ARABIC", "Arabic Language", "اللغة العربية", "CORE", 12, "arabic:A:4"],
  ["TAW_ISLAMIC", "Islamic Education", "التربية الإسلامية", "CORE", 12, "islamic_studies:S:3"],
]);

export const CURRICULUM_COURSES: CourseSeed[] = [...AMERICAN, ...BRITISH, ...IB, ...CBSE, ...ISC, ...SABIS, ...UAE_MOE, ...TAWJIHI];
