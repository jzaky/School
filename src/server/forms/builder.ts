// Pure helpers for the form builder, shared by the client builder and the server actions.
// Nothing here touches the database.
import { FIELD_TYPES, PREFILL_KEYS, type Condition, type FieldOption, type FieldType, type FormField, type FormSchema, type FormSection, type FormStep, type I18nText } from "./schema";

export const CHOICE_TYPES: FieldType[] = ["select", "multi_select", "radio", "checkbox"];
/** Choice types that cannot work without options. A checkbox without options is a single tick box. */
export const OPTIONS_REQUIRED: FieldType[] = ["select", "multi_select", "radio"];
export const RANGE_TYPES: FieldType[] = ["number", "rating", "scale"];
export const LENGTH_TYPES: FieldType[] = ["short_text", "long_text"];
export const PLACEHOLDER_TYPES: FieldType[] = ["short_text", "long_text", "number", "email", "phone", "select", "subject_picker"];
export const PREFILL_TYPES: FieldType[] = ["short_text", "email", "phone", "date"];
export const CONDITION_OPS = ["eq", "neq", "contains", "gt", "lt", "empty", "not_empty"] as const;
export type SimpleOp = (typeof CONDITION_OPS)[number];

/** Palette groups shown in the builder. */
export const PALETTE: Array<{ group: "text" | "choice" | "date" | "people" | "other"; types: FieldType[] }> = [
  { group: "text", types: ["short_text", "long_text", "number", "email", "phone"] },
  { group: "choice", types: ["select", "radio", "multi_select", "checkbox", "yes_no", "rating", "scale"] },
  { group: "date", types: ["date", "time"] },
  { group: "people", types: ["student_picker", "staff_picker", "subject_picker"] },
  { group: "other", types: ["file", "signature", "consent", "statement"] },
];

const t = (en: string, ar: string): I18nText => ({ en, ar });
const o = (value: string, en: string, ar: string): FieldOption => ({ value, label: t(en, ar) });

/** Bilingual starting labels for a new field. The admin renames them in the inspector. */
export const DEFAULT_LABELS: Record<FieldType, I18nText> = {
  short_text: t("Short answer", "إجابة قصيرة"),
  long_text: t("Details", "التفاصيل"),
  number: t("Number", "رقم"),
  email: t("Email address", "البريد الإلكتروني"),
  phone: t("Phone number", "رقم الهاتف"),
  date: t("Date", "التاريخ"),
  time: t("Time", "الوقت"),
  select: t("Choose one", "اختر خيارًا"),
  multi_select: t("Choose all that apply", "اختر كل ما ينطبق"),
  radio: t("Pick one", "اختر واحدًا"),
  checkbox: t("I confirm", "أؤكد ذلك"),
  yes_no: t("Yes or no?", "نعم أم لا؟"),
  rating: t("Rating", "التقييم"),
  scale: t("On a scale", "على مقياس"),
  file: t("Attachment", "مرفق"),
  signature: t("Signature", "التوقيع"),
  statement: t("Please read", "يُرجى القراءة"),
  student_picker: t("Student", "الطالب"),
  staff_picker: t("Staff member", "الموظف"),
  subject_picker: t("Subject", "المادة"),
  consent: t("Consent", "الموافقة"),
};

export function uid(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 7)}`;
}

export function newField(type: FieldType, taken: Set<string>): FormField {
  let id = uid(type.split("_")[0]);
  while (taken.has(id)) id = uid(type.split("_")[0]);
  const f: FormField = { id, type, label: { ...DEFAULT_LABELS[type] } };
  if (OPTIONS_REQUIRED.includes(type)) f.options = [o("option_1", "Option 1", "الخيار 1"), o("option_2", "Option 2", "الخيار 2")];
  if (type === "rating") f.max = 5;
  if (type === "scale") {
    f.min = 1;
    f.max = 10;
  }
  if (type === "consent") f.help = t("I give my consent.", "أوافق على ذلك.");
  if (type === "statement") f.help = t("Add the text people should read here.", "أضف هنا النص المطلوب قراءته.");
  if (type === "time" || type === "date" || type === "phone" || type === "email") f.width = "half";
  return f;
}

export function newSection(): FormSection {
  return { id: uid("section"), fields: [] };
}

export function newStep(n: number): FormStep {
  return { id: uid("step"), title: t(`Step ${n}`, `الخطوة ${n}`), sections: [newSection()] };
}

export function blankSchema(): FormSchema {
  return { version: 1, steps: [{ id: "details", title: t("Details", "التفاصيل"), sections: [newSection()] }] };
}

export function fieldsOf(schema: FormSchema): FormField[] {
  return schema.steps.flatMap((s) => s.sections.flatMap((sec) => sec.fields));
}

export function fieldCount(schema: FormSchema | null | undefined) {
  return schema ? fieldsOf(schema).filter((f) => f.type !== "statement").length : 0;
}

/** Field ids a condition refers to. */
export function conditionRefs(c: Condition | undefined): string[] {
  if (!c) return [];
  if ("all" in c) return c.all.flatMap(conditionRefs);
  if ("any" in c) return c.any.flatMap(conditionRefs);
  return [c.fieldId];
}

export function isSimpleCondition(c: Condition | undefined): c is Extract<Condition, { fieldId: string }> & { op: SimpleOp } {
  return Boolean(c && "fieldId" in c && (CONDITION_OPS as readonly string[]).includes(c.op));
}

export function renameInCondition(c: Condition | undefined, from: string, to: string): Condition | undefined {
  if (!c) return c;
  if ("all" in c) return { all: c.all.map((x) => renameInCondition(x, from, to)!) };
  if ("any" in c) return { any: c.any.map((x) => renameInCondition(x, from, to)!) };
  return c.fieldId === from ? { ...c, fieldId: to } : c;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const ID_RE = /^[A-Za-z][A-Za-z0-9_]{0,47}$/;
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown, max = 2000) => (typeof v === "string" ? v.slice(0, max) : "");

function text(v: unknown, max = 500): I18nText | undefined {
  if (typeof v === "string") return v.trim() ? { en: v.slice(0, max), ar: "" } : undefined;
  if (!isObj(v)) return undefined;
  const en = str(v.en, max);
  const ar = str(v.ar, max);
  return en || ar ? { en, ar } : undefined;
}

function cond(v: unknown, depth = 0): Condition | undefined {
  if (!isObj(v) || depth > 4) return undefined;
  if (Array.isArray(v.all)) {
    const all = v.all.map((x) => cond(x, depth + 1)).filter(Boolean) as Condition[];
    return all.length ? { all } : undefined;
  }
  if (Array.isArray(v.any)) {
    const any = v.any.map((x) => cond(x, depth + 1)).filter(Boolean) as Condition[];
    return any.length ? { any } : undefined;
  }
  const ops = ["eq", "neq", "in", "not_in", "gt", "lt", "contains", "empty", "not_empty"];
  if (typeof v.fieldId !== "string" || typeof v.op !== "string" || !ops.includes(v.op)) return undefined;
  const value = v.value;
  const okValue = value === undefined || ["string", "number", "boolean"].includes(typeof value) || (Array.isArray(value) && value.every((x) => ["string", "number", "boolean"].includes(typeof x)));
  if (!okValue) return undefined;
  return { fieldId: v.fieldId, op: v.op as "eq", ...(value !== undefined ? { value } : {}) };
}

function num(v: unknown) {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

function field(v: unknown, taken: Set<string>): FormField | null {
  if (!isObj(v)) return null;
  if (typeof v.type !== "string" || !(FIELD_TYPES as readonly string[]).includes(v.type)) return null;
  const type = v.type as FieldType;
  let id = typeof v.id === "string" && ID_RE.test(v.id) ? v.id : uid(type.split("_")[0]);
  while (taken.has(id)) id = uid(type.split("_")[0]);
  taken.add(id);
  const label = text(v.label) ?? { ...DEFAULT_LABELS[type] };
  const f: FormField = { id, type, label };
  const help = text(v.help, 2000);
  if (help) f.help = help;
  const placeholder = text(v.placeholder);
  if (placeholder) f.placeholder = placeholder;
  if (v.required === true) f.required = true;
  if (Array.isArray(v.options)) {
    const seen = new Set<string>();
    const options = v.options
      .map((x): FieldOption | null => {
        if (!isObj(x)) return null;
        const value = typeof x.value === "string" || typeof x.value === "number" ? String(x.value).slice(0, 80) : "";
        const lbl = text(x.label, 200);
        if (!value || !lbl || seen.has(value)) return null;
        seen.add(value);
        return { value, label: lbl };
      })
      .filter(Boolean) as FieldOption[];
    if (options.length) f.options = options.slice(0, 60);
  }
  if (OPTIONS_REQUIRED.includes(type) && !f.options?.length) f.options = [o("option_1", "Option 1", "الخيار 1"), o("option_2", "Option 2", "الخيار 2")];
  const min = num(v.min);
  const max = num(v.max);
  const maxLength = num(v.maxLength);
  if (min !== undefined) f.min = min;
  if (max !== undefined) f.max = max;
  if (maxLength !== undefined && maxLength > 0) f.maxLength = Math.round(maxLength);
  if (typeof v.prefill === "string" && (PREFILL_KEYS as readonly string[]).includes(v.prefill)) f.prefill = v.prefill as FormField["prefill"];
  if (v.readOnly === true) f.readOnly = true;
  const showIf = cond(v.showIf);
  if (showIf) f.showIf = showIf;
  if (v.width === "half") f.width = "half";
  return f;
}

/**
 * Coerce untrusted JSON (a builder save or an AI answer) into a valid FormSchema.
 * Unknown field types are dropped, ids are made unique, choice fields always get options.
 * Returns null when nothing usable is left.
 */
export function sanitizeSchema(v: unknown): FormSchema | null {
  if (!isObj(v) || !Array.isArray(v.steps)) return null;
  const taken = new Set<string>();
  const ids = new Set<string>();
  const unique = (id: unknown, prefix: string) => {
    let out = typeof id === "string" && ID_RE.test(id) ? id : uid(prefix);
    while (ids.has(out)) out = uid(prefix);
    ids.add(out);
    return out;
  };
  const steps: FormStep[] = v.steps.slice(0, 12).map((s, i) => {
    const so = isObj(s) ? s : {};
    const sections = (Array.isArray(so.sections) ? so.sections : []).slice(0, 20).map((sec) => {
      const x = isObj(sec) ? sec : {};
      const out: FormSection = { id: unique(x.id, "section"), fields: (Array.isArray(x.fields) ? x.fields : []).slice(0, 80).map((f) => field(f, taken)).filter(Boolean) as FormField[] };
      const title = text(x.title);
      const description = text(x.description, 2000);
      const showIf = cond(x.showIf);
      if (title) out.title = title;
      if (description) out.description = description;
      if (showIf) out.showIf = showIf;
      return out;
    });
    return { id: unique(so.id, "step"), title: text(so.title) ?? t(`Step ${i + 1}`, `الخطوة ${i + 1}`), sections: sections.length ? sections : [newSection()] };
  });
  if (!steps.length) return null;
  const schema: FormSchema = { version: 1, steps };
  const submitLabel = text(v.submitLabel);
  if (submitLabel) schema.submitLabel = submitLabel;
  return schema;
}

export type SchemaIssue =
  | { code: "noFields" }
  | { code: "labelEn" | "labelAr" | "noOptions" | "optionLabel" | "badCondition" | "rangeOrder"; fieldId: string }
  | { code: "stepTitle"; stepId: string };

/** Problems that block publishing. Drafts can be saved with issues. */
export function schemaIssues(schema: FormSchema): SchemaIssue[] {
  const issues: SchemaIssue[] = [];
  const fields = fieldsOf(schema);
  if (!fields.some((f) => f.type !== "statement")) issues.push({ code: "noFields" });
  const ids = new Set(fields.map((f) => f.id));
  for (const s of schema.steps) if (!s.title.en.trim() || !s.title.ar.trim()) issues.push({ code: "stepTitle", stepId: s.id });
  for (const f of fields) {
    if (!f.label.en.trim()) issues.push({ code: "labelEn", fieldId: f.id });
    if (!f.label.ar.trim()) issues.push({ code: "labelAr", fieldId: f.id });
    if (OPTIONS_REQUIRED.includes(f.type) && !f.options?.length) issues.push({ code: "noOptions", fieldId: f.id });
    if (f.options?.some((x) => !x.value.trim() || !x.label.en.trim() || !x.label.ar.trim())) issues.push({ code: "optionLabel", fieldId: f.id });
    if (conditionRefs(f.showIf).some((r) => !ids.has(r) || r === f.id)) issues.push({ code: "badCondition", fieldId: f.id });
    if (f.min !== undefined && f.max !== undefined && f.min > f.max) issues.push({ code: "rangeOrder", fieldId: f.id });
  }
  return issues;
}

// ---------------------------------------------------------------------------
// Deterministic draft used when no AI model is configured
// ---------------------------------------------------------------------------

type Topic = { match: RegExp; name: I18nText; description: I18nText; fields: () => FormField[] };

const studentField = (): FormField => ({ id: "student", type: "student_picker", label: t("Student", "الطالب"), required: true });

const TOPICS: Topic[] = [
  {
    match: /trip|excursion|visit|outing|رحل|زيار/i,
    name: t("School trip consent", "موافقة على رحلة مدرسية"),
    description: t("Parents give consent for their child to join a school trip.", "يوافق ولي الأمر على مشاركة ابنه أو ابنته في رحلة مدرسية."),
    fields: () => [
      studentField(),
      { id: "tripDate", type: "date", label: t("Trip date", "تاريخ الرحلة"), required: true, width: "half" },
      { id: "emergencyPhone", type: "phone", label: t("Emergency contact number", "رقم التواصل في حالات الطوارئ"), required: true, width: "half" },
      { id: "hasAllergies", type: "yes_no", label: t("Does your child have allergies we should know about?", "هل لدى طفلك حساسية يجب أن نعرفها؟"), required: true },
      { id: "allergyDetails", type: "long_text", label: t("Allergy details", "تفاصيل الحساسية"), required: true, showIf: { fieldId: "hasAllergies", op: "eq", value: true } },
      { id: "tripConsent", type: "consent", label: t("Consent", "الموافقة"), help: t("I give permission for my child to join this trip.", "أوافق على مشاركة طفلي في هذه الرحلة."), required: true },
      { id: "signature", type: "signature", label: t("Parent signature", "توقيع ولي الأمر"), required: true },
    ],
  },
  {
    match: /absen|leave|sick|holiday|غياب|إجاز|اجاز/i,
    name: t("Leave of absence request", "طلب إذن غياب"),
    description: t("Request approval for a planned absence from school.", "اطلب الموافقة على غياب مخطط له عن المدرسة."),
    fields: () => [
      studentField(),
      { id: "fromDate", type: "date", label: t("First day of absence", "أول يوم غياب"), required: true, width: "half" },
      { id: "toDate", type: "date", label: t("Last day of absence", "آخر يوم غياب"), required: true, width: "half" },
      {
        id: "reason",
        type: "select",
        label: t("Reason", "السبب"),
        required: true,
        options: [o("medical", "Medical appointment", "موعد طبي"), o("family", "Family event", "مناسبة عائلية"), o("travel", "Travel", "سفر"), o("other", "Something else", "سبب آخر")],
      },
      { id: "otherReason", type: "short_text", label: t("Please describe the reason", "يُرجى توضيح السبب"), required: true, showIf: { fieldId: "reason", op: "eq", value: "other" } },
      { id: "evidence", type: "file", label: t("Supporting document", "مستند داعم") },
    ],
  },
  {
    match: /feedback|survey|satisf|opinion|rate|استبيان|رأي|ملاحظ|تقييم/i,
    name: t("Feedback survey", "استبيان الملاحظات"),
    description: t("Tell us how we are doing so we can improve.", "شاركنا رأيك لنتمكن من التحسين."),
    fields: () => [
      { id: "overall", type: "rating", label: t("Overall, how satisfied are you?", "ما مدى رضاك بشكل عام؟"), required: true, max: 5 },
      { id: "recommend", type: "scale", label: t("How likely are you to recommend us?", "ما مدى احتمال أن توصي بنا؟"), min: 0, max: 10 },
      { id: "liked", type: "long_text", label: t("What went well?", "ما الذي أعجبك؟"), maxLength: 1000 },
      { id: "improve", type: "long_text", label: t("What could be better?", "ما الذي يمكن تحسينه؟"), maxLength: 1000 },
      { id: "contactMe", type: "yes_no", label: t("May we contact you about your answers?", "هل يمكننا التواصل معك بشأن إجاباتك؟") },
      { id: "email", type: "email", label: t("Email address", "البريد الإلكتروني"), required: true, showIf: { fieldId: "contactMe", op: "eq", value: true } },
    ],
  },
  {
    match: /club|activit|sport|team|نادي|نشاط|رياض/i,
    name: t("Activity sign-up", "التسجيل في نشاط"),
    description: t("Sign up for an after-school club or activity.", "سجّل في نادٍ أو نشاط بعد الدوام المدرسي."),
    fields: () => [
      studentField(),
      {
        id: "activity",
        type: "radio",
        label: t("Which activity?", "أي نشاط؟"),
        required: true,
        options: [o("football", "Football", "كرة القدم"), o("robotics", "Robotics", "الروبوتات"), o("debate", "Debate club", "نادي المناظرات"), o("drama", "Drama", "المسرح")],
      },
      { id: "days", type: "multi_select", label: t("Which days suit you?", "ما الأيام المناسبة لك؟"), options: [o("mon", "Monday", "الاثنين"), o("tue", "Tuesday", "الثلاثاء"), o("wed", "Wednesday", "الأربعاء"), o("thu", "Thursday", "الخميس")] },
      { id: "pickup", type: "yes_no", label: t("Will the student be collected by a parent?", "هل سيستلم ولي الأمر الطالب؟") },
      { id: "parentConsent", type: "consent", label: t("Parent consent", "موافقة ولي الأمر"), help: t("I agree to my child taking part.", "أوافق على مشاركة طفلي."), required: true },
    ],
  },
  {
    match: /meet|appointment|call|اجتماع|موعد|لقاء/i,
    name: t("Meeting request", "طلب اجتماع"),
    description: t("Ask for a meeting with a member of staff.", "اطلب اجتماعًا مع أحد الموظفين."),
    fields: () => [
      studentField(),
      { id: "withStaff", type: "staff_picker", label: t("Who would you like to meet?", "مع من تودّ الاجتماع؟"), required: true },
      { id: "preferredDate", type: "date", label: t("Preferred date", "التاريخ المفضل"), width: "half" },
      { id: "preferredTime", type: "time", label: t("Preferred time", "الوقت المفضل"), width: "half" },
      {
        id: "format",
        type: "radio",
        label: t("Meeting format", "طريقة الاجتماع"),
        required: true,
        options: [o("in_person", "In person", "حضوريًا"), o("online", "Online", "عبر الإنترنت"), o("phone", "Phone call", "مكالمة هاتفية")],
      },
      { id: "phone", type: "phone", label: t("Best number to call", "أفضل رقم للاتصال"), required: true, showIf: { fieldId: "format", op: "eq", value: "phone" } },
      { id: "topic", type: "long_text", label: t("What would you like to discuss?", "ما الموضوع الذي تودّ مناقشته؟"), required: true, maxLength: 1000 },
    ],
  },
  {
    match: /letter|certificat|document|transcript|شهاد|خطاب|وثيق|مستند/i,
    name: t("Document request", "طلب وثيقة"),
    description: t("Request an official letter or certificate from the school.", "اطلب خطابًا رسميًا أو شهادة من المدرسة."),
    fields: () => [
      studentField(),
      {
        id: "documentType",
        type: "select",
        label: t("Which document?", "ما الوثيقة المطلوبة؟"),
        required: true,
        options: [o("enrolment", "Enrolment letter", "خطاب قيد"), o("transcript", "Transcript", "كشف درجات"), o("good_conduct", "Good conduct letter", "شهادة حسن سيرة وسلوك"), o("other", "Something else", "وثيقة أخرى")],
      },
      { id: "otherDocument", type: "short_text", label: t("Which other document?", "ما الوثيقة الأخرى؟"), required: true, showIf: { fieldId: "documentType", op: "eq", value: "other" } },
      { id: "addressedTo", type: "short_text", label: t("Who is it addressed to?", "إلى من يُوجَّه؟"), placeholder: t("For example, an embassy or a bank", "مثل سفارة أو بنك") },
      { id: "neededBy", type: "date", label: t("Needed by", "مطلوب قبل"), width: "half" },
    ],
  },
  {
    match: /bus|transport|route|نقل|حافل|مواصل/i,
    name: t("Transport request", "طلب النقل المدرسي"),
    description: t("Request a bus place or a change to a bus route.", "اطلب مقعدًا في الحافلة أو تغيير مسارها."),
    fields: () => [
      studentField(),
      { id: "requestType", type: "radio", label: t("What do you need?", "ما الذي تحتاجه؟"), required: true, options: [o("new", "A new bus place", "مقعد جديد في الحافلة"), o("change", "Change of route or stop", "تغيير المسار أو المحطة"), o("cancel", "Cancel bus service", "إلغاء خدمة الحافلة")] },
      { id: "area", type: "short_text", label: t("Home area", "منطقة السكن"), required: true, showIf: { fieldId: "requestType", op: "neq", value: "cancel" } },
      { id: "startDate", type: "date", label: t("From date", "اعتبارًا من تاريخ"), required: true, width: "half" },
      { id: "phone", type: "phone", label: t("Contact number", "رقم التواصل"), required: true, width: "half" },
    ],
  },
];

const GENERIC: Topic = {
  match: /.^/,
  name: t("New request form", "نموذج طلب جديد"),
  description: t("Collect the details the school needs to handle this request.", "اجمع التفاصيل التي تحتاجها المدرسة لمعالجة هذا الطلب."),
  fields: () => [
    studentField(),
    {
      id: "requestType",
      type: "select",
      label: t("What is this about?", "ما موضوع الطلب؟"),
      required: true,
      options: [o("academic", "Academics", "الشؤون الأكاديمية"), o("admin", "Administration", "الشؤون الإدارية"), o("other", "Something else", "أمر آخر")],
    },
    { id: "otherType", type: "short_text", label: t("Please describe", "يُرجى التوضيح"), required: true, showIf: { fieldId: "requestType", op: "eq", value: "other" } },
    { id: "details", type: "long_text", label: t("Details", "التفاصيل"), required: true, maxLength: 1500 },
    { id: "attachment", type: "file", label: t("Attachment", "مرفق") },
  ],
};

export type FormDraftResult = { name: I18nText; description: I18nText; schema: FormSchema };

/** Build a sensible form from keywords in the admin's description. */
export function draftFormFromPrompt(prompt: string): FormDraftResult {
  const topic = TOPICS.find((x) => x.match.test(prompt)) ?? GENERIC;
  const fields = topic.fields();
  const ids = new Set(fields.map((f) => f.id));
  // Add commonly requested extras the topic did not include.
  const extras: Array<[RegExp, FormField]> = [
    [/sign|توقيع/i, { id: "signature", type: "signature", label: t("Signature", "التوقيع"), required: true }],
    [/attach|upload|file|مرفق|ملف/i, { id: "attachment", type: "file", label: t("Attachment", "مرفق") }],
    [/email|بريد/i, { id: "email", type: "email", label: t("Email address", "البريد الإلكتروني"), width: "half" }],
    [/phone|mobile|هاتف|جوال/i, { id: "phone", type: "phone", label: t("Phone number", "رقم الهاتف"), width: "half" }],
    [/consent|permission|agree|موافق|إذن/i, { id: "consent", type: "consent", label: t("Consent", "الموافقة"), help: t("I agree to the above.", "أوافق على ما سبق."), required: true }],
  ];
  for (const [re, f] of extras) if (re.test(prompt) && !ids.has(f.id) && !fields.some((x) => x.type === f.type)) fields.push(f);
  return {
    name: topic.name,
    description: topic.description,
    schema: { version: 1, steps: [{ id: "details", title: t("Details", "التفاصيل"), sections: [{ id: "main", fields }] }] },
  };
}
