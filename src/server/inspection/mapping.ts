// Which evidence heading relates to which area of a UAE regulator's inspection framework.
// The defaults below are a suggested starting point, stored per school as InspectionMapping rows so a
// school can change them without a code change. They are not a statement of compliance: every row
// carries a note that the school must check its regulator's current framework.
// Pure: no database access here (see ensureInspectionMapping in ./seed.ts).

export const EVIDENCE_HEADINGS = ["safeguarding", "wellbeing", "parents", "careers", "attendance", "compliance"] as const;
export type EvidenceHeading = (typeof EVIDENCE_HEADINGS)[number];

export const FRAMEWORKS = ["KHDA", "ADEK", "SPEA", "MOE"] as const;
export type Framework = (typeof FRAMEWORKS)[number];

export type MappingRow = {
  headingKey: string;
  framework: string;
  areaEn: string;
  areaAr: string;
  noteEn?: string | null;
  noteAr?: string | null;
  sortOrder?: number;
  customized?: boolean;
};

export const CHECK_NOTE = {
  en: "Suggested starting point. Check your regulator's current framework and edit this mapping if it differs.",
  ar: "نقطة بداية مقترحة. راجع الإطار المعتمد حاليًا لدى الجهة التنظيمية وعدّل هذا الربط إذا كان مختلفًا.",
};

// Performance standards of the UAE School Inspection Framework, which Dubai, Abu Dhabi and federal
// inspections have used. SPEA publishes its own evaluation framework, so its rows say so.
const PS = {
  achievement: { en: "Performance standard 1: Students' achievement", ar: "معيار الأداء 1: إنجاز الطلاب" },
  personal: {
    en: "Performance standard 2: Students' personal and social development, and their innovation skills",
    ar: "معيار الأداء 2: التطور الشخصي والاجتماعي للطلاب ومهارات الابتكار لديهم",
  },
  care: {
    en: "Performance standard 5: The protection, care, guidance and support of students",
    ar: "معيار الأداء 5: حماية الطلاب ورعايتهم وتوجيههم ودعمهم",
  },
  leadership: { en: "Performance standard 6: Leadership and management", ar: "معيار الأداء 6: القيادة والإدارة" },
};

type Area = { en: string; ar: string };
const join = (...areas: Area[]): Area => ({ en: areas.map((a) => a.en).join("; "), ar: areas.map((a) => a.ar).join("؛ ") });

const BY_HEADING: Record<EvidenceHeading, Area> = {
  safeguarding: PS.care,
  wellbeing: join(PS.care, PS.personal),
  parents: PS.leadership,
  careers: PS.care,
  attendance: join(PS.achievement, PS.personal),
  compliance: PS.leadership,
};

const SPEA_NOTE = {
  en: "SPEA uses its own school evaluation framework. Match this heading to the relevant SPEA area before relying on it.",
  ar: "تعتمد هيئة الشارقة للتعليم الخاص إطارها الخاص لتقييم المدارس. اربط هذا العنوان بالمجال المناسب في إطارها قبل الاعتماد عليه.",
};

/** The seeded default mapping: one row per heading and framework. */
export function defaultMapping(): MappingRow[] {
  const rows: MappingRow[] = [];
  EVIDENCE_HEADINGS.forEach((h, hi) => {
    FRAMEWORKS.forEach((f, fi) => {
      const area = BY_HEADING[h];
      const note = f === "SPEA" ? SPEA_NOTE : CHECK_NOTE;
      rows.push({ headingKey: h, framework: f, areaEn: area.en, areaAr: area.ar, noteEn: note.en, noteAr: note.ar, sortOrder: hi * 10 + fi, customized: false });
    });
  });
  return rows;
}

/**
 * The mapping to show: the school's stored rows win over the defaults for the same heading and framework,
 * and any heading or framework without a stored row falls back to the default. Rows for unknown headings
 * or frameworks are ignored.
 */
export function resolveMapping(stored: MappingRow[]): MappingRow[] {
  const key = (r: MappingRow) => `${r.headingKey}|${r.framework}`;
  const mine = new Map(stored.filter((r) => (EVIDENCE_HEADINGS as readonly string[]).includes(r.headingKey) && (FRAMEWORKS as readonly string[]).includes(r.framework)).map((r) => [key(r), r]));
  return defaultMapping().map((d) => {
    const s = mine.get(key(d));
    return s ? { ...d, ...s, sortOrder: d.sortOrder } : d;
  });
}

/**
 * Rows for one heading, the school's own regulator first. For a school whose regulator is not one of the
 * four (OTHER), every framework is listed in the default order.
 */
export function mappingForHeading(rows: MappingRow[], heading: string, regulator: string): MappingRow[] {
  const mine = rows.filter((r) => r.headingKey === heading);
  return [...mine].sort((a, b) => {
    const pa = a.framework === regulator ? 0 : 1;
    const pb = b.framework === regulator ? 0 : 1;
    return pa - pb || (a.sortOrder ?? 0) - (b.sortOrder ?? 0);
  });
}
