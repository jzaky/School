"use client";

import { useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { usePathname, useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { Switch } from "@/components/ui/switch";
import { setLocaleAction } from "@/server/shell/actions";
import { setDisplayAction } from "@/server/settings/actions";

function Segmented({ value, options, onChange, disabled, testId }: { value: string; options: Array<{ value: string; label: string }>; onChange: (v: string) => void; disabled?: boolean; testId?: string }) {
  return (
    <div className="inline-flex gap-1 rounded-lg bg-muted p-1" role="radiogroup" data-testid={testId}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          disabled={disabled}
          onClick={() => onChange(o.value)}
          className={cn("rounded-md px-3 py-1.5 text-sm font-medium transition", value === o.value ? "bg-card shadow-xs" : "text-muted-foreground hover:text-foreground")}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Row({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <p className="text-sm font-medium">{title}</p>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

export function DisplaySettings({ hijri, hijriAvailable, numerals }: { hijri: boolean; hijriAvailable: boolean; numerals: "WESTERN" | "ARABIC_INDIC" }) {
  const t = useTranslations("settings");
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const [pending, start] = useTransition();
  const [h, setH] = useState(hijri);
  const [num, setNum] = useState<string>(numerals);
  const save = (input: Parameters<typeof setDisplayAction>[0]) =>
    start(async () => {
      await setDisplayAction(input);
      toast.success(t("saved"));
      router.refresh();
    });
  return (
    <div className="divide-y">
      <Row title={t("language")} hint={t("languageHint")}>
        <Segmented
          value={locale}
          disabled={pending}
          testId="settings-language"
          options={[
            { value: "en", label: "English" },
            { value: "ar", label: "العربية" },
          ]}
          onChange={(v) =>
            v !== locale &&
            start(async () => {
              await setLocaleAction(v);
              router.replace(pathname, { locale: v });
              router.refresh();
            })
          }
        />
      </Row>
      <Row title={t("numerals")} hint={t("numeralsHint")}>
        <Segmented
          value={num}
          disabled={pending}
          options={[
            { value: "WESTERN", label: "123" },
            { value: "ARABIC_INDIC", label: "١٢٣" },
          ]}
          onChange={(v) => {
            setNum(v);
            save({ numerals: v as "WESTERN" | "ARABIC_INDIC" });
          }}
        />
      </Row>
      <Row title={t("hijri")} hint={hijriAvailable ? t("hijriHint") : t("hijriOff")}>
        <Switch
          checked={h && hijriAvailable}
          disabled={!hijriAvailable || pending}
          aria-label={t("hijri")}
          onCheckedChange={(v) => {
            setH(v);
            save({ hijri: v });
          }}
        />
      </Row>
    </div>
  );
}
