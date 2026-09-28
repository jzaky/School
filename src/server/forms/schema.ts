// Form schema stored in FormVersion.schema. Shared by the builder, the renderer and the seed.

export type I18nText = { en: string; ar: string };

export const FIELD_TYPES = [
  "short_text",
  "long_text",
  "number",
  "email",
  "phone",
  "date",
  "time",
  "select",
  "multi_select",
  "radio",
  "checkbox",
  "yes_no",
  "rating",
  "scale",
  "file",
  "signature",
  "statement",
  "student_picker",
  "staff_picker",
  "subject_picker",
  "consent",
] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

export type Condition =
  | { fieldId: string; op: "eq" | "neq" | "in" | "not_in" | "gt" | "lt" | "contains" | "empty" | "not_empty"; value?: unknown }
  | { all: Condition[] }
  | { any: Condition[] };

/** Values a field can be prefilled from, resolved from the signed-in user and the selected student. */
export const PREFILL_KEYS = [
  "student.fullName",
  "student.grade",
  "student.studentNo",
  "student.homeroom",
  "requester.name",
  "requester.email",
  "requester.phone",
  "guardian.name",
  "today",
] as const;
export type PrefillKey = (typeof PREFILL_KEYS)[number];

export type FieldOption = { value: string; label: I18nText };

export type FormField = {
  id: string;
  type: FieldType;
  label: I18nText;
  help?: I18nText;
  placeholder?: I18nText;
  required?: boolean;
  options?: FieldOption[];
  min?: number;
  max?: number;
  maxLength?: number;
  prefill?: PrefillKey;
  readOnly?: boolean;
  showIf?: Condition;
  width?: "full" | "half";
};

export type FormSection = {
  id: string;
  title?: I18nText;
  description?: I18nText;
  showIf?: Condition;
  fields: FormField[];
};

export type FormStep = {
  id: string;
  title: I18nText;
  sections: FormSection[];
};

export type FormSchema = {
  version: 1;
  steps: FormStep[];
  submitLabel?: I18nText;
};

export type FormTemplate = {
  key: string;
  name: I18nText;
  description: I18nText;
  category: I18nText;
  schema: FormSchema;
};
