"use client";

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { Copy, GitBranch, Plus, Trash2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { FIELD_TYPES, PREFILL_KEYS, type Condition, type FieldType, type FormField, type FormSection, type FormStep, type I18nText } from "@/server/forms/schema";
import { CHOICE_TYPES, CONDITION_OPS, LENGTH_TYPES, OPTIONS_REQUIRED, PLACEHOLDER_TYPES, PREFILL_TYPES, RANGE_TYPES, isSimpleCondition, type SimpleOp } from "@/server/forms/builder";

const KEY_RE = /^[A-Za-z][A-Za-z0-9_]{0,47}$/;

export function tx(locale: string, v?: I18nText) {
  if (!v) return "";
  return locale === "ar" ? v.ar || v.en : v.en || v.ar;
}

/** English and Arabic inputs side by side. Arabic is typed right to left. */
export function BiInput({ id, label, value, onChange, multiline, optional, testId }: { id: string; label: string; value: I18nText | undefined; onChange: (v: I18nText | undefined) => void; multiline?: boolean; optional?: boolean; testId?: string }) {
  const t = useTranslations("adminForms");
  const v = value ?? { en: "", ar: "" };
  const set = (patch: Partial<I18nText>) => {
    const next = { ...v, ...patch };
    onChange(optional && !next.en && !next.ar ? undefined : next);
  };
  const C = multiline ? Textarea : Input;
  return (
    <fieldset className="space-y-1.5">
      <legend className="mb-1.5 text-xs font-medium text-muted-foreground">
        {label}
        {optional && <span className="ms-1 font-normal">({t("optional")})</span>}
      </legend>
      <div className="grid gap-2">
        <div className="relative" dir="ltr">
          <span className="pointer-events-none absolute start-2 top-2 rounded bg-muted px-1 text-[10px] font-semibold text-muted-foreground">{t("langEn")}</span>
          <C id={`${id}-en`} dir="ltr" value={v.en} onChange={(e) => set({ en: e.target.value })} className={cn("ps-10", multiline && "min-h-16")} aria-label={`${label} (${t("english")})`} data-testid={testId ? `${testId}-en` : undefined} />
        </div>
        <div className="relative" dir="rtl">
          <span className="pointer-events-none absolute start-2 top-2 rounded bg-muted px-1 text-[10px] font-semibold text-muted-foreground">{t("langAr")}</span>
          <C id={`${id}-ar`} dir="rtl" value={v.ar} onChange={(e) => set({ ar: e.target.value })} className={cn("ps-10 text-start", multiline && "min-h-16")} aria-label={`${label} (${t("arabic")})`} data-testid={testId ? `${testId}-ar` : undefined} />
        </div>
      </div>
    </fieldset>
  );
}

function Row({ label, htmlFor, children, hint }: { label: string; htmlFor?: string; children: React.ReactNode; hint?: string }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={htmlFor} className="text-xs font-medium text-muted-foreground">
        {label}
      </Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

function numOrUndef(s: string) {
  if (s.trim() === "") return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
}

// ---------------------------------------------------------------------------
// Conditional visibility
// ---------------------------------------------------------------------------

function opsFor(source: FormField | undefined): SimpleOp[] {
  if (!source) return [...CONDITION_OPS];
  if (source.type === "multi_select" || (source.type === "checkbox" && source.options?.length)) return ["contains", "empty", "not_empty"];
  if (RANGE_TYPES.includes(source.type)) return ["eq", "neq", "gt", "lt", "empty", "not_empty"];
  if (source.options?.length || source.type === "yes_no" || source.type === "consent" || source.type === "checkbox") return ["eq", "neq", "empty", "not_empty"];
  return ["eq", "neq", "contains", "empty", "not_empty"];
}

function defaultValue(source: FormField): unknown {
  if (source.options?.length) return source.options[0].value;
  if (source.type === "yes_no" || source.type === "consent" || source.type === "checkbox") return true;
  if (RANGE_TYPES.includes(source.type)) return source.min ?? 1;
  return "";
}

export function ConditionEditor({ value, onChange, candidates, testId }: { value: Condition | undefined; onChange: (c: Condition | undefined) => void; candidates: FormField[]; testId: string }) {
  const t = useTranslations("adminForms");
  const locale = useLocale();
  const on = Boolean(value);
  const simple = isSimpleCondition(value) ? value : null;
  const source = simple ? candidates.find((c) => c.id === simple.fieldId) : undefined;
  const ops = opsFor(source);

  const toggle = (next: boolean) => {
    if (!next) return onChange(undefined);
    const src = candidates[0];
    if (!src) return;
    onChange({ fieldId: src.id, op: opsFor(src)[0], value: defaultValue(src) });
  };

  const sw = <Switch id={`${testId}-on`} checked={on} onCheckedChange={toggle} disabled={!on && !candidates.length} data-testid={`${testId}-toggle`} />;
  return (
    <div className="space-y-3 rounded-lg border p-3">
      <div className="flex items-center justify-between gap-3">
        <Label htmlFor={`${testId}-on`} className="flex items-center gap-1.5 text-sm font-medium">
          <GitBranch className="size-4 text-muted-foreground" />
          {t("showWhen")}
        </Label>
        {!on && !candidates.length ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <span>{sw}</span>
            </TooltipTrigger>
            <TooltipContent>{t("conditionNeedsField")}</TooltipContent>
          </Tooltip>
        ) : (
          sw
        )}
      </div>
      {on && !simple && (
        <div className="flex items-start justify-between gap-2 text-xs text-muted-foreground">
          <p>{t("advancedCondition")}</p>
          <Button variant="ghost" size="xs" onClick={() => onChange(undefined)}>
            <X className="size-3" />
            {t("removeRule")}
          </Button>
        </div>
      )}
      {simple && (
        <div className="grid gap-2">
          <Select
            value={source ? simple.fieldId : undefined}
            onValueChange={(id) => {
              const src = candidates.find((c) => c.id === id)!;
              onChange({ fieldId: id, op: opsFor(src)[0], value: defaultValue(src) });
            }}
          >
            <SelectTrigger className="w-full" data-testid={`${testId}-field`} aria-label={t("conditionField")}>
              <SelectValue placeholder={t("missingField")}>{source ? tx(locale, source.label) : undefined}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {candidates.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {tx(locale, c.label) || c.id}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={simple.op} onValueChange={(op) => onChange({ ...simple, op: op as SimpleOp, ...(op === "empty" || op === "not_empty" ? { value: undefined } : { value: simple.value ?? (source ? defaultValue(source) : "") }) })}>
            <SelectTrigger className="w-full" data-testid={`${testId}-op`} aria-label={t("conditionOp")}>
              <SelectValue>{t(`ops.${simple.op}`)}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {ops.map((op) => (
                <SelectItem key={op} value={op}>
                  {t(`ops.${op}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {simple.op !== "empty" && simple.op !== "not_empty" && source && <ConditionValue source={source} value={simple.value} onChange={(v) => onChange({ ...simple, value: v })} testId={testId} />}
        </div>
      )}
    </div>
  );
}

function ConditionValue({ source, value, onChange, testId }: { source: FormField; value: unknown; onChange: (v: unknown) => void; testId: string }) {
  const t = useTranslations("adminForms");
  const locale = useLocale();
  if (source.options?.length) {
    const cur = source.options.find((o) => o.value === String(value ?? ""));
    return (
      <Select value={cur?.value} onValueChange={onChange}>
        <SelectTrigger className="w-full" data-testid={`${testId}-value`} aria-label={t("conditionValue")}>
          <SelectValue placeholder={t("chooseValue")}>{cur ? tx(locale, cur.label) : undefined}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {source.options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {tx(locale, o.label)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }
  if (source.type === "yes_no" || source.type === "consent" || source.type === "checkbox") {
    const cur = String(value) === "false" ? "false" : "true";
    return (
      <Select value={cur} onValueChange={(v) => onChange(v === "true")}>
        <SelectTrigger className="w-full" data-testid={`${testId}-value`} aria-label={t("conditionValue")}>
          <SelectValue>{cur === "true" ? t("yes") : t("no")}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="true">{t("yes")}</SelectItem>
          <SelectItem value="false">{t("no")}</SelectItem>
        </SelectContent>
      </Select>
    );
  }
  const numeric = RANGE_TYPES.includes(source.type);
  return (
    <Input
      type={numeric ? "number" : "text"}
      value={value === undefined || value === null ? "" : String(value)}
      onChange={(e) => onChange(numeric ? numOrUndef(e.target.value) : e.target.value)}
      placeholder={t("conditionValue")}
      aria-label={t("conditionValue")}
      data-testid={`${testId}-value`}
    />
  );
}

// ---------------------------------------------------------------------------
// Field inspector
// ---------------------------------------------------------------------------

export function FieldInspector({
  field: f,
  candidates,
  takenIds,
  onChange,
  onRename,
  onDuplicate,
  onDelete,
}: {
  field: FormField;
  candidates: FormField[];
  takenIds: Set<string>;
  onChange: (patch: Partial<FormField>) => void;
  onRename: (to: string) => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const t = useTranslations("adminForms");
  const [key, setKey] = useState(f.id);
  useEffect(() => setKey(f.id), [f.id]);

  const commitKey = () => {
    const k = key.trim();
    if (k === f.id) return;
    if (!KEY_RE.test(k)) {
      toast.error(t("errors.KEY_FORMAT"));
      return setKey(f.id);
    }
    if (takenIds.has(k)) {
      toast.error(t("errors.KEY_TAKEN"));
      return setKey(f.id);
    }
    onRename(k);
  };

  const changeType = (type: FieldType) => {
    const patch: Partial<FormField> = { type };
    if (OPTIONS_REQUIRED.includes(type) && !f.options?.length) {
      patch.options = [
        { value: "option_1", label: { en: "Option 1", ar: "الخيار 1" } },
        { value: "option_2", label: { en: "Option 2", ar: "الخيار 2" } },
      ];
    }
    if (!CHOICE_TYPES.includes(type)) patch.options = undefined;
    if (!RANGE_TYPES.includes(type)) Object.assign(patch, { min: undefined, max: undefined });
    if (!LENGTH_TYPES.includes(type)) patch.maxLength = undefined;
    if (!PREFILL_TYPES.includes(type)) Object.assign(patch, { prefill: undefined, readOnly: undefined });
    onChange(patch);
  };

  const opts = f.options ?? [];
  const setOption = (i: number, patch: Partial<(typeof opts)[number]>) => onChange({ options: opts.map((o, j) => (j === i ? { ...o, ...patch } : o)) });
  const addOption = () => {
    let n = opts.length + 1;
    while (opts.some((o) => o.value === `option_${n}`)) n++;
    onChange({ options: [...opts, { value: `option_${n}`, label: { en: `Option ${n}`, ar: `الخيار ${n}` } }] });
  };

  return (
    <div className="space-y-5" data-testid="field-inspector">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">{t("fieldSettings")}</h3>
        <div className="flex gap-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon-sm" onClick={onDuplicate} aria-label={t("duplicate")}>
                <Copy className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t("duplicate")}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon-sm" onClick={onDelete} aria-label={t("deleteField")} className="text-danger hover:text-danger" data-testid="field-delete">
                <Trash2 className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t("deleteField")}</TooltipContent>
          </Tooltip>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
        <Row label={t("fieldType")}>
          <Select value={f.type} onValueChange={(v) => changeType(v as FieldType)}>
            <SelectTrigger className="w-full" aria-label={t("fieldType")}>
              <SelectValue>{t(`types.${f.type}`)}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {FIELD_TYPES.map((ft) => (
                <SelectItem key={ft} value={ft}>
                  {t(`types.${ft}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Row>
        <Row label={t("fieldKey")} htmlFor="field-key">
          <Input id="field-key" dir="ltr" value={key} onChange={(e) => setKey(e.target.value)} onBlur={commitKey} onKeyDown={(e) => e.key === "Enter" && commitKey()} className="font-mono text-xs" />
        </Row>
      </div>

      <BiInput id="field-label" label={t("label")} value={f.label} onChange={(v) => onChange({ label: v ?? { en: "", ar: "" } })} testId="field-label" />
      <BiInput id="field-help" label={f.type === "statement" || f.type === "consent" ? t("bodyText") : t("helpText")} value={f.help} onChange={(v) => onChange({ help: v })} multiline optional={f.type !== "statement" && f.type !== "consent"} />
      {PLACEHOLDER_TYPES.includes(f.type) && <BiInput id="field-ph" label={t("placeholder")} value={f.placeholder} onChange={(v) => onChange({ placeholder: v })} optional />}

      {f.type !== "statement" && (
        <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
          <Label htmlFor="field-required" className="text-sm font-medium">
            {t("required")}
          </Label>
          <Switch id="field-required" checked={Boolean(f.required)} onCheckedChange={(v) => onChange({ required: v || undefined })} data-testid="field-required" />
        </div>
      )}

      <Row label={t("width")}>
        <div className="grid grid-cols-2 gap-1 rounded-lg bg-muted p-1">
          {(["full", "half"] as const).map((w) => (
            <button
              key={w}
              type="button"
              aria-pressed={(f.width ?? "full") === w}
              onClick={() => onChange({ width: w === "half" ? "half" : undefined })}
              className={cn("rounded-md px-2 py-1 text-xs font-medium transition", (f.width ?? "full") === w ? "bg-card shadow-xs" : "text-muted-foreground hover:text-foreground")}
            >
              {t(`width_${w}`)}
            </button>
          ))}
        </div>
      </Row>

      {CHOICE_TYPES.includes(f.type) && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">{t("options")}</span>
            <Button variant="ghost" size="xs" onClick={addOption} data-testid="option-add">
              <Plus className="size-3" />
              {t("addOption")}
            </Button>
          </div>
          {f.type === "checkbox" && !opts.length && <p className="text-xs text-muted-foreground">{t("checkboxSingle")}</p>}
          <ul className="space-y-2">
            {opts.map((o, i) => (
              <li key={i} className="space-y-1.5 rounded-lg border p-2" data-testid="option-row">
                <div className="flex items-center gap-1.5">
                  <Input dir="ltr" value={o.value} onChange={(e) => setOption(i, { value: e.target.value.replace(/\s+/g, "_") })} className="h-8 font-mono text-xs" aria-label={t("optionValue")} />
                  <Button variant="ghost" size="icon-sm" onClick={() => onChange({ options: opts.filter((_, j) => j !== i) })} disabled={OPTIONS_REQUIRED.includes(f.type) && opts.length <= 1} aria-label={t("removeOption")}>
                    <X className="size-4" />
                  </Button>
                </div>
                <div className="grid grid-cols-2 gap-1.5">
                  <Input dir="ltr" value={o.label.en} onChange={(e) => setOption(i, { label: { ...o.label, en: e.target.value } })} className="h-8" aria-label={`${t("optionLabel")} (${t("english")})`} placeholder={t("english")} />
                  <Input dir="rtl" value={o.label.ar} onChange={(e) => setOption(i, { label: { ...o.label, ar: e.target.value } })} className="h-8" aria-label={`${t("optionLabel")} (${t("arabic")})`} placeholder={t("arabic")} />
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {(RANGE_TYPES.includes(f.type) || LENGTH_TYPES.includes(f.type)) && (
        <div className="space-y-2">
          <span className="text-xs font-medium text-muted-foreground">{t("validation")}</span>
          {RANGE_TYPES.includes(f.type) ? (
            <div className="grid grid-cols-2 gap-2">
              <Row label={t("min")} htmlFor="field-min">
                <Input id="field-min" type="number" value={f.min ?? ""} onChange={(e) => onChange({ min: numOrUndef(e.target.value) })} />
              </Row>
              <Row label={t("max")} htmlFor="field-max">
                <Input id="field-max" type="number" value={f.max ?? ""} onChange={(e) => onChange({ max: numOrUndef(e.target.value) })} />
              </Row>
            </div>
          ) : (
            <Row label={t("maxLength")} htmlFor="field-maxlen" hint={t("maxLengthHint")}>
              <Input id="field-maxlen" type="number" min={1} value={f.maxLength ?? ""} onChange={(e) => onChange({ maxLength: numOrUndef(e.target.value) })} />
            </Row>
          )}
        </div>
      )}

      {PREFILL_TYPES.includes(f.type) && (
        <div className="space-y-2">
          <Row label={t("prefill")} hint={t("prefillHint")}>
            <Select value={f.prefill ?? "none"} onValueChange={(v) => onChange(v === "none" ? { prefill: undefined, readOnly: undefined } : { prefill: v as FormField["prefill"] })}>
              <SelectTrigger className="w-full" aria-label={t("prefill")}>
                <SelectValue>{f.prefill ? t(`prefillKeys.${f.prefill.replace(".", "_")}`) : t("prefillNone")}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">{t("prefillNone")}</SelectItem>
                {PREFILL_KEYS.map((k) => (
                  <SelectItem key={k} value={k}>
                    {t(`prefillKeys.${k.replace(".", "_")}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Row>
          {f.prefill && (
            <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
              <Label htmlFor="field-ro" className="text-sm">
                {t("readOnly")}
              </Label>
              <Switch id="field-ro" checked={Boolean(f.readOnly)} onCheckedChange={(v) => onChange({ readOnly: v || undefined })} />
            </div>
          )}
        </div>
      )}

      <ConditionEditor value={f.showIf} onChange={(c) => onChange({ showIf: c })} candidates={candidates} testId="field-cond" />
    </div>
  );
}

export function SectionInspector({ section, candidates, canDelete, onChange, onDelete }: { section: FormSection; candidates: FormField[]; canDelete: boolean; onChange: (patch: Partial<FormSection>) => void; onDelete: () => void }) {
  const t = useTranslations("adminForms");
  const del = (
    <Button variant="ghost" size="icon-sm" onClick={onDelete} disabled={!canDelete} aria-label={t("deleteSection")} className="text-danger hover:text-danger">
      <Trash2 className="size-4" />
    </Button>
  );
  return (
    <div className="space-y-5" data-testid="section-inspector">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">{t("sectionSettings")}</h3>
        <Tooltip>
          <TooltipTrigger asChild>
            <span>{del}</span>
          </TooltipTrigger>
          <TooltipContent>{canDelete ? t("deleteSection") : t("lastSection")}</TooltipContent>
        </Tooltip>
      </div>
      <BiInput id="section-title" label={t("sectionTitle")} value={section.title} onChange={(v) => onChange({ title: v })} optional />
      <BiInput id="section-desc" label={t("sectionDescription")} value={section.description} onChange={(v) => onChange({ description: v })} multiline optional />
      <ConditionEditor value={section.showIf} onChange={(c) => onChange({ showIf: c })} candidates={candidates} testId="section-cond" />
      {section.fields.length > 0 && canDelete && <p className="text-xs text-muted-foreground">{t("deleteSectionHint")}</p>}
    </div>
  );
}

export function StepInspector({ step, canDelete, onChange, onDelete }: { step: FormStep; canDelete: boolean; onChange: (patch: Partial<FormStep>) => void; onDelete: () => void }) {
  const t = useTranslations("adminForms");
  const del = (
    <Button variant="ghost" size="icon-sm" onClick={onDelete} disabled={!canDelete} aria-label={t("deleteStep")} className="text-danger hover:text-danger">
      <Trash2 className="size-4" />
    </Button>
  );
  return (
    <div className="space-y-5" data-testid="step-inspector">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">{t("stepSettings")}</h3>
        <Tooltip>
          <TooltipTrigger asChild>
            <span>{del}</span>
          </TooltipTrigger>
          <TooltipContent>{canDelete ? t("deleteStep") : t("lastStep")}</TooltipContent>
        </Tooltip>
      </div>
      <BiInput id="step-title" label={t("stepTitle")} value={step.title} onChange={(v) => onChange({ title: v ?? { en: "", ar: "" } })} />
      <p className="text-xs text-muted-foreground">{t("stepHint")}</p>
    </div>
  );
}
