// Form logic shared by the client renderer and the server validator.
import type { Condition, FormField, FormSchema, FormSection } from "./schema";

export type FormValues = Record<string, unknown>;

function isEmpty(v: unknown) {
  return v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0);
}

export function evalCondition(cond: Condition | undefined, values: FormValues): boolean {
  if (!cond) return true;
  if ("all" in cond) return cond.all.every((c) => evalCondition(c, values));
  if ("any" in cond) return cond.any.some((c) => evalCondition(c, values));
  const v = values[cond.fieldId];
  switch (cond.op) {
    case "eq":
      return Array.isArray(v) ? v.includes(cond.value as never) : String(v ?? "") === String(cond.value ?? "");
    case "neq":
      return String(v ?? "") !== String(cond.value ?? "");
    case "in":
      return Array.isArray(cond.value) && (cond.value as unknown[]).map(String).includes(String(v ?? ""));
    case "not_in":
      return !(Array.isArray(cond.value) && (cond.value as unknown[]).map(String).includes(String(v ?? "")));
    case "gt":
      return Number(v) > Number(cond.value);
    case "lt":
      return Number(v) < Number(cond.value);
    case "contains":
      return Array.isArray(v) ? v.map(String).includes(String(cond.value)) : String(v ?? "").includes(String(cond.value));
    case "empty":
      return isEmpty(v);
    case "not_empty":
      return !isEmpty(v);
    default:
      return true;
  }
}

export function allFields(schema: FormSchema): FormField[] {
  return schema.steps.flatMap((s) => s.sections.flatMap((sec) => sec.fields));
}

export function sectionVisible(section: FormSection, values: FormValues) {
  return evalCondition(section.showIf, values);
}

export function fieldVisible(field: FormField, values: FormValues) {
  return evalCondition(field.showIf, values);
}

/** Visible, input-bearing fields for a set of values. */
export function visibleFields(schema: FormSchema, values: FormValues, stepIndex?: number): FormField[] {
  const steps = stepIndex === undefined ? schema.steps : [schema.steps[stepIndex]].filter(Boolean);
  return steps.flatMap((s) =>
    s.sections.filter((sec) => sectionVisible(sec, values)).flatMap((sec) => sec.fields.filter((f) => fieldVisible(f, values))),
  );
}

export type FieldError = { fieldId: string; code: "required" | "min" | "max" | "email" | "phone" | "number" | "maxLength" | "option" };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^[+()\d\s-]{7,20}$/;

export function validateValues(schema: FormSchema, values: FormValues, stepIndex?: number): FieldError[] {
  const errors: FieldError[] = [];
  for (const f of visibleFields(schema, values, stepIndex)) {
    if (f.type === "statement") continue;
    const v = values[f.id];
    if (f.required && (isEmpty(v) || (f.type === "consent" && v !== true))) {
      errors.push({ fieldId: f.id, code: "required" });
      continue;
    }
    if (isEmpty(v)) continue;
    if (f.type === "email" && !EMAIL_RE.test(String(v))) errors.push({ fieldId: f.id, code: "email" });
    if (f.type === "phone" && !PHONE_RE.test(String(v))) errors.push({ fieldId: f.id, code: "phone" });
    if (f.type === "number" || f.type === "rating" || f.type === "scale") {
      const n = Number(v);
      if (Number.isNaN(n)) errors.push({ fieldId: f.id, code: "number" });
      else if (f.min !== undefined && n < f.min) errors.push({ fieldId: f.id, code: "min" });
      else if (f.max !== undefined && n > f.max) errors.push({ fieldId: f.id, code: "max" });
    }
    if ((f.type === "short_text" || f.type === "long_text") && f.maxLength && String(v).length > f.maxLength) {
      errors.push({ fieldId: f.id, code: "maxLength" });
    }
    if ((f.type === "select" || f.type === "radio") && f.options?.length && !f.options.some((o) => o.value === String(v))) {
      errors.push({ fieldId: f.id, code: "option" });
    }
    if (f.type === "multi_select" && f.options?.length && Array.isArray(v) && v.some((x) => !f.options!.some((o) => o.value === x))) {
      errors.push({ fieldId: f.id, code: "option" });
    }
  }
  return errors;
}

/** Drop values for fields that are hidden by conditional logic so they are never stored. */
export function pruneHidden(schema: FormSchema, values: FormValues): FormValues {
  const keep = new Set(visibleFields(schema, values).map((f) => f.id));
  return Object.fromEntries(Object.entries(values).filter(([k]) => keep.has(k)));
}
