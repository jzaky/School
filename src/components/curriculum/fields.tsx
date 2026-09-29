"use client";

import { useTranslations } from "next-intl";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const NONE = "__none";

/** A select over plain options. An empty value is shown with noneLabel when given. */
export function SimpleSelect({
  options,
  value,
  onChange,
  placeholder,
  noneLabel,
  id,
  testId,
}: {
  options: Array<{ value: string; label: string }>;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  noneLabel?: string;
  id?: string;
  testId?: string;
}) {
  const current = options.find((o) => o.value === value);
  return (
    <Select value={value || (noneLabel ? NONE : "")} onValueChange={(v) => onChange(v === NONE ? "" : v)}>
      <SelectTrigger className="w-full" id={id} data-testid={testId}>
        <SelectValue placeholder={placeholder}>{current?.label ?? (noneLabel && !value ? noneLabel : undefined)}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        {noneLabel && <SelectItem value={NONE}>{noneLabel}</SelectItem>}
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** Turn an action error code into a message. */
export function useCurriculumError() {
  const t = useTranslations("curriculum.error");
  return (code?: string) => (code && t.has(code) ? t(code) : t("generic"));
}
