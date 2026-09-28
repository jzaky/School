"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, Check, ChevronLeft, ChevronRight, Info, Loader2, Paperclip, Star, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { fieldVisible, sectionVisible, validateValues, type FieldError, type FormValues } from "@/server/forms/logic";
import type { FormField, FormSchema, I18nText } from "@/server/forms/schema";
import { SignaturePad } from "./signature-pad";
import { PickerCombobox, type PickerOption } from "./picker-combobox";

export type RendererOptions = {
  students: PickerOption[];
  staff: PickerOption[];
  subjects: PickerOption[];
};

export type FormRendererProps = {
  schema: FormSchema;
  initialValues?: FormValues;
  initialStep?: number;
  options: RendererOptions;
  lockedFields?: string[];
  onSubmit: (values: FormValues) => Promise<{ ok: boolean; fieldErrors?: FieldError[] } | void>;
  onDraft?: (values: FormValues, step: number) => Promise<unknown>;
  submitLabel?: string;
  preview?: boolean;
  footerExtra?: React.ReactNode;
};

function tx(locale: string, t?: I18nText) {
  if (!t) return "";
  return locale === "ar" ? t.ar || t.en : t.en || t.ar;
}

export function FormRenderer({ schema, initialValues, initialStep = 0, options, lockedFields = [], onSubmit, onDraft, submitLabel, preview, footerExtra }: FormRendererProps) {
  const t = useTranslations("forms");
  const locale = useLocale();
  const [values, setValues] = useState<FormValues>(initialValues ?? {});
  const [step, setStep] = useState(Math.min(initialStep, schema.steps.length - 1));
  const [errors, setErrors] = useState<FieldError[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [draftState, setDraftState] = useState<"idle" | "saving" | "saved">("idle");
  const dirty = useRef(false);
  const total = schema.steps.length;
  const current = schema.steps[step];

  const setValue = useCallback((id: string, v: unknown) => {
    dirty.current = true;
    setValues((prev) => ({ ...prev, [id]: v }));
    setErrors((prev) => prev.filter((e) => e.fieldId !== id));
  }, []);

  // Auto-save drafts, debounced.
  useEffect(() => {
    if (!onDraft || preview || !dirty.current) return;
    const h = setTimeout(async () => {
      setDraftState("saving");
      await onDraft(values, step);
      setDraftState("saved");
    }, 1200);
    return () => clearTimeout(h);
  }, [values, step, onDraft, preview]);

  const errorFor = (id: string) => errors.find((e) => e.fieldId === id);

  const next = () => {
    const errs = validateValues(schema, values, step);
    if (errs.length) {
      setErrors(errs);
      document.getElementById(`field-${errs[0].fieldId}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    setStep((s) => Math.min(s + 1, total - 1));
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const submit = async () => {
    const errs = validateValues(schema, values);
    if (errs.length) {
      setErrors(errs);
      const firstStep = schema.steps.findIndex((s) => s.sections.some((sec) => sec.fields.some((f) => f.id === errs[0].fieldId)));
      if (firstStep >= 0) setStep(firstStep);
      return;
    }
    setSubmitting(true);
    try {
      const res = await onSubmit(values);
      if (res && !res.ok && res.fieldErrors?.length) setErrors(res.fieldErrors);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      {total > 1 && (
        <ol className="flex items-center gap-2" aria-label={t("progress")}>
          {schema.steps.map((s, i) => (
            <li key={s.id} className="flex flex-1 items-center gap-2">
              <button
                type="button"
                onClick={() => i < step && setStep(i)}
                disabled={i > step}
                className={cn(
                  "flex min-w-0 items-center gap-2 text-start text-xs font-medium",
                  i === step ? "text-foreground" : i < step ? "text-success" : "text-muted-foreground",
                )}
              >
                <span
                  className={cn(
                    "grid size-6 shrink-0 place-items-center rounded-full border text-[11px] tabular-nums",
                    i === step && "border-brand bg-brand text-brand-foreground",
                    i < step && "border-success bg-success text-white",
                  )}
                >
                  {i < step ? <Check className="size-3.5" /> : i + 1}
                </span>
                <span className="hidden truncate sm:inline">{tx(locale, s.title)}</span>
              </button>
              {i < total - 1 && <span className={cn("h-px flex-1", i < step ? "bg-success" : "bg-border")} />}
            </li>
          ))}
        </ol>
      )}

      <AnimatePresence mode="wait">
        <motion.div key={current.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.18 }} className="space-y-8">
          {current.sections.filter((sec) => sectionVisible(sec, values)).map((sec) => (
            <fieldset key={sec.id} className="space-y-5">
              {(sec.title || sec.description) && (
                <div>
                  {sec.title && <legend className="text-sm font-semibold">{tx(locale, sec.title)}</legend>}
                  {sec.description && <p className="mt-0.5 text-sm text-muted-foreground">{tx(locale, sec.description)}</p>}
                </div>
              )}
              <div className="grid gap-5 sm:grid-cols-2">
                {sec.fields.map((f) => (
                  <AnimatePresence key={f.id} initial={false}>
                    {fieldVisible(f, values) && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: "auto" }}
                        exit={{ opacity: 0, height: 0 }}
                        className={cn(f.width === "half" ? "sm:col-span-1" : "sm:col-span-2")}
                        id={`field-${f.id}`}
                      >
                        <Field
                          field={f}
                          value={values[f.id]}
                          onChange={(v) => setValue(f.id, v)}
                          error={errorFor(f.id)}
                          options={options}
                          locked={lockedFields.includes(f.id) || Boolean(f.readOnly && values[f.id] !== undefined && values[f.id] !== "")}
                        />
                      </motion.div>
                    )}
                  </AnimatePresence>
                ))}
              </div>
            </fieldset>
          ))}
        </motion.div>
      </AnimatePresence>

      <div className="flex flex-col-reverse gap-3 border-t pt-5 sm:flex-row sm:items-center">
        <div className="text-xs text-muted-foreground" aria-live="polite">
          {draftState === "saving" && t("draftSaving")}
          {draftState === "saved" && t("draftSaved")}
          {footerExtra}
        </div>
        <div className="flex gap-2 sm:ms-auto">
          {step > 0 && (
            <Button type="button" variant="outline" onClick={() => setStep((s) => s - 1)} disabled={submitting}>
              <ChevronLeft className="size-4 rtl:rotate-180" />
              {t("back")}
            </Button>
          )}
          {step < total - 1 ? (
            <Button type="button" onClick={next} data-testid="form-next">
              {t("next")}
              <ChevronRight className="size-4 rtl:rotate-180" />
            </Button>
          ) : (
            <Button type="button" onClick={submit} disabled={submitting || preview} data-testid="form-submit">
              {submitting && <Loader2 className="size-4 animate-spin" />}
              {submitLabel ?? (schema.submitLabel ? tx(locale, schema.submitLabel) : t("submit"))}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function Field({
  field: f,
  value,
  onChange,
  error,
  options,
  locked,
}: {
  field: FormField;
  value: unknown;
  onChange: (v: unknown) => void;
  error?: FieldError;
  options: RendererOptions;
  locked: boolean;
}) {
  const t = useTranslations("forms");
  const locale = useLocale();
  const label = tx(locale, f.label);
  const help = tx(locale, f.help);
  const placeholder = tx(locale, f.placeholder);
  const id = `f-${f.id}`;
  const invalid = Boolean(error);

  if (f.type === "statement") {
    const danger = /danger|emergency|خطر|طوارئ/i.test(f.id + label);
    return (
      <div className={cn("flex gap-3 rounded-lg border p-4 text-sm", danger ? "border-danger/30 bg-danger-soft text-danger" : "border-info/20 bg-info-soft/60")}>
        {danger ? <AlertTriangle className="mt-0.5 size-4 shrink-0" /> : <Info className="mt-0.5 size-4 shrink-0 text-info" />}
        <div>
          <p className="font-medium">{label}</p>
          {help && <p className={cn("mt-1", danger ? "" : "text-muted-foreground")}>{help}</p>}
        </div>
      </div>
    );
  }

  const header = (
    <div className="mb-1.5 flex items-baseline justify-between gap-2">
      <Label htmlFor={id} className="leading-snug">
        {label}
        {f.required ? <span className="ms-0.5 text-danger">*</span> : <span className="ms-1.5 text-xs font-normal text-muted-foreground">{t("optional")}</span>}
      </Label>
    </div>
  );
  const footer = (
    <>
      {help && !invalid && <p className="mt-1.5 text-xs text-muted-foreground">{help}</p>}
      {invalid && (
        <p className="mt-1.5 text-xs font-medium text-danger" role="alert">
          {t(`error.${error!.code}`, { min: f.min ?? 0, max: f.max ?? 0 })}
        </p>
      )}
    </>
  );
  const str = value === undefined || value === null ? "" : String(value);
  const opts = f.options ?? [];

  let control: React.ReactNode;
  switch (f.type) {
    case "short_text":
    case "email":
    case "phone":
    case "number":
      control = (
        <Input
          id={id}
          type={f.type === "email" ? "email" : f.type === "phone" ? "tel" : f.type === "number" ? "number" : "text"}
          value={str}
          placeholder={placeholder}
          min={f.min}
          max={f.max}
          maxLength={f.maxLength}
          readOnly={locked}
          dir={f.type === "email" || f.type === "phone" ? "ltr" : undefined}
          className={cn(locked && "bg-muted/60", (f.type === "email" || f.type === "phone") && "text-start")}
          aria-invalid={invalid}
          onChange={(e) => onChange(f.type === "number" ? (e.target.value === "" ? "" : Number(e.target.value)) : e.target.value)}
        />
      );
      break;
    case "long_text":
      control = <Textarea id={id} value={str} placeholder={placeholder} rows={4} maxLength={f.maxLength} readOnly={locked} aria-invalid={invalid} onChange={(e) => onChange(e.target.value)} />;
      break;
    case "date":
    case "time":
      control = <Input id={id} type={f.type} value={str} readOnly={locked} aria-invalid={invalid} onChange={(e) => onChange(e.target.value)} className="w-full sm:w-56" />;
      break;
    case "select":
      control = (
        <Select value={str || undefined} onValueChange={onChange} disabled={locked}>
          <SelectTrigger id={id} className="w-full" aria-invalid={invalid}>
            <SelectValue placeholder={placeholder || t("choose")} />
          </SelectTrigger>
          <SelectContent>
            {opts.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {tx(locale, o.label)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
      break;
    case "radio":
      control = (
        <div role="radiogroup" className={cn("grid gap-2", opts.length > 3 || opts.length === 2 ? "sm:grid-cols-2" : opts.length === 3 ? "sm:grid-cols-3" : "")}>
          {opts.map((o) => {
            const on = str === o.value;
            const danger = o.value === "IMMEDIATE_DANGER";
            return (
              <button
                key={o.value}
                type="button"
                role="radio"
                aria-checked={on}
                disabled={locked}
                onClick={() => onChange(o.value)}
                data-testid={`opt-${f.id}-${o.value}`}
                className={cn(
                  "flex items-center gap-2.5 rounded-lg border px-3 py-2.5 text-start text-sm transition",
                  on ? (danger ? "border-danger bg-danger-soft text-danger" : "border-brand bg-brand-soft/60 text-foreground ring-1 ring-brand/30") : "hover:border-foreground/20 hover:bg-muted/40",
                )}
              >
                <span className={cn("grid size-4 shrink-0 place-items-center rounded-full border", on && (danger ? "border-danger" : "border-brand"))}>
                  {on && <span className={cn("size-2 rounded-full", danger ? "bg-danger" : "bg-brand")} />}
                </span>
                {tx(locale, o.label)}
              </button>
            );
          })}
        </div>
      );
      break;
    case "multi_select":
    case "checkbox": {
      if (!opts.length) {
        control = (
          <label className="flex items-start gap-3 rounded-lg border px-3 py-3 text-sm">
            <Checkbox id={id} checked={value === true} onCheckedChange={(c) => onChange(c === true)} disabled={locked} className="mt-0.5" />
            <span>{help || label}</span>
          </label>
        );
        break;
      }
      const arr = Array.isArray(value) ? (value as string[]) : [];
      control = (
        <div className="flex flex-wrap gap-2">
          {opts.map((o) => {
            const on = arr.includes(o.value);
            return (
              <button
                key={o.value}
                type="button"
                aria-pressed={on}
                disabled={locked}
                onClick={() => onChange(on ? arr.filter((x) => x !== o.value) : [...arr, o.value])}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm transition",
                  on ? "border-brand bg-brand text-brand-foreground" : "hover:border-foreground/25 hover:bg-muted/40",
                )}
              >
                {on && <Check className="size-3.5" />}
                {tx(locale, o.label)}
              </button>
            );
          })}
        </div>
      );
      break;
    }
    case "yes_no":
      control = (
        <div className="flex gap-2">
          {[true, false].map((b) => (
            <button
              key={String(b)}
              type="button"
              disabled={locked}
              aria-pressed={value === b}
              onClick={() => onChange(b)}
              className={cn("min-w-20 rounded-lg border px-4 py-2 text-sm font-medium transition", value === b ? "border-brand bg-brand text-brand-foreground" : "hover:bg-muted/40")}
            >
              {b ? t("yes") : t("no")}
            </button>
          ))}
        </div>
      );
      break;
    case "rating": {
      const n = Number(value) || 0;
      const max = f.max ?? 5;
      control = (
        <div className="flex gap-1" dir="ltr">
          {Array.from({ length: max }, (_, i) => i + 1).map((i) => (
            <button key={i} type="button" onClick={() => onChange(i)} aria-label={String(i)} disabled={locked}>
              <Star className={cn("size-7 transition", i <= n ? "fill-gold text-gold" : "text-border")} />
            </button>
          ))}
        </div>
      );
      break;
    }
    case "scale": {
      const min = f.min ?? 1;
      const max = f.max ?? 10;
      control = (
        <div className="flex flex-wrap gap-1.5">
          {Array.from({ length: max - min + 1 }, (_, i) => i + min).map((i) => (
            <button
              key={i}
              type="button"
              disabled={locked}
              onClick={() => onChange(i)}
              className={cn("size-9 rounded-md border text-sm tabular-nums transition", Number(value) === i ? "border-brand bg-brand text-brand-foreground" : "hover:bg-muted/50")}
            >
              {i}
            </button>
          ))}
        </div>
      );
      break;
    }
    case "consent":
      control = (
        <label className={cn("flex items-start gap-3 rounded-lg border px-3 py-3 text-sm", invalid && "border-danger/50")}>
          <Checkbox id={id} checked={value === true} onCheckedChange={(c) => onChange(c === true)} disabled={locked} className="mt-0.5" data-testid={`consent-${f.id}`} />
          <span>{help || label}</span>
        </label>
      );
      return (
        <div>
          {header}
          {control}
          {invalid && <p className="mt-1.5 text-xs font-medium text-danger">{t("error.required")}</p>}
        </div>
      );
    case "signature":
      control = <SignaturePad value={str} onChange={onChange} disabled={locked} />;
      break;
    case "file": {
      const file = value as { name?: string; size?: number } | undefined;
      control = file?.name ? (
        <div className="flex items-center gap-3 rounded-lg border px-3 py-2.5 text-sm">
          <Paperclip className="size-4 text-muted-foreground" />
          <span className="flex-1 truncate">{file.name}</span>
          <button type="button" onClick={() => onChange(undefined)} aria-label={t("removeFile")}>
            <X className="size-4" />
          </button>
        </div>
      ) : (
        <FileInput id={id} onUploaded={onChange} disabled={locked} />
      );
      break;
    }
    case "student_picker":
      control = <PickerCombobox id={id} options={options.students} value={str} onChange={onChange} disabled={locked} placeholder={t("chooseStudent")} testId={`picker-${f.id}`} />;
      break;
    case "staff_picker":
      control = <PickerCombobox id={id} options={options.staff} value={str} onChange={onChange} disabled={locked} placeholder={t("chooseStaff")} testId={`picker-${f.id}`} />;
      break;
    case "subject_picker":
      control = <PickerCombobox id={id} options={options.subjects} value={str} onChange={onChange} disabled={locked} placeholder={placeholder || t("chooseSubject")} testId={`picker-${f.id}`} />;
      break;
    default:
      control = null;
  }
  return (
    <div>
      {header}
      {control}
      {footer}
    </div>
  );
}

function FileInput({ id, onUploaded, disabled }: { id: string; onUploaded: (v: unknown) => void; disabled?: boolean }) {
  const t = useTranslations("forms");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  return (
    <label htmlFor={id} className={cn("flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed px-3 py-5 text-sm text-muted-foreground transition hover:bg-muted/40", disabled && "pointer-events-none opacity-60")}>
      {busy ? <Loader2 className="size-4 animate-spin" /> : <Paperclip className="size-4" />}
      {failed ? t("uploadFailed") : t("chooseFile")}
      <input
        id={id}
        type="file"
        className="sr-only"
        disabled={disabled}
        onChange={async (e) => {
          const file = e.target.files?.[0];
          if (!file) return;
          setBusy(true);
          setFailed(false);
          try {
            const body = new FormData();
            body.append("file", file);
            const res = await fetch("/api/uploads", { method: "POST", body });
            if (!res.ok) throw new Error("upload");
            onUploaded(await res.json());
          } catch {
            setFailed(true);
          } finally {
            setBusy(false);
          }
        }}
      />
    </label>
  );
}

export function useFormOptionsLabel(options: PickerOption[], value: string) {
  return useMemo(() => options.find((o) => o.value === value)?.label ?? "", [options, value]);
}
