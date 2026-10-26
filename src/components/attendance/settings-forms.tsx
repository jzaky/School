"use client";

// Attendance settings: who keeps the register, times, lesson registers per grade, follow-up, persistent absence,
// heads of year and the regulator absence limit; and the school's attendance codes.
import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Loader2, Plus, Save, ShieldAlert } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { saveCodesAction, saveSettingsAction } from "@/server/attendance/actions";

export type SettingsValue = {
  mode: "HORIZON" | "EXTERNAL";
  dailyStart: string;
  lateCutoffMin: number;
  closeTime: string;
  followUpTime: string;
  autoNotify: boolean;
  persistentThreshold: number;
  persistentMinDays: number;
  dailyOnlyGrades: number[];
  headsOfYear: Record<string, string[]>;
  limitEnabled: boolean;
  limitConsecutive: number;
  limitTotal: number;
  limitWarnPct: number;
};

const SHARJAH = { limitConsecutive: 10, limitTotal: 15 };

export function AttendanceSettingsForm({ initial, grades, staff }: { initial: SettingsValue; grades: Array<{ value: number; label: string }>; staff: Array<{ id: string; name: string }> }) {
  const t = useTranslations("attendance.settings");
  const router = useRouter();
  const [s, setS] = useState<SettingsValue>(initial);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const set = (patch: Partial<SettingsValue>) => setS((cur) => ({ ...cur, ...patch }));
  const save = () =>
    start(async () => {
      setError(null);
      const res = await saveSettingsAction(s);
      if (!res.ok) return setError(t.has(`error.${res.error}`) ? t(`error.${res.error}`) : t("error.generic"));
      toast.success(t("saved"));
      router.refresh();
    });
  const section = "space-y-4 rounded-xl border bg-card p-5 shadow-xs";
  const num = (v: string) => (v === "" ? NaN : Number(v));

  return (
    <div className="space-y-5" data-testid="attendance-settings">
      <section className={section}>
        <div>
          <h2 className="text-sm font-semibold">{t("registerTitle")}</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">{t("registerBody")}</p>
        </div>
        <RadioGroup value={s.mode} onValueChange={(v) => set({ mode: v as SettingsValue["mode"] })} className="gap-2">
          {(["HORIZON", "EXTERNAL"] as const).map((m) => (
            <Label key={m} className={cn("flex cursor-pointer items-start gap-3 rounded-lg border p-3 font-normal", s.mode === m && "border-brand bg-brand-soft/40")} data-testid={`mode-${m}`}>
              <RadioGroupItem value={m} className="mt-0.5" />
              <span>
                <span className="block text-sm font-medium">{t(`mode.${m}`)}</span>
                <span className="block text-xs text-muted-foreground">{t(`modeHelp.${m}`)}</span>
              </span>
            </Label>
          ))}
        </RadioGroup>
      </section>

      <section className={section}>
        <h2 className="text-sm font-semibold">{t("timesTitle")}</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("dailyStart")} help={t("dailyStartHelp")}>
            <Input type="time" value={s.dailyStart} onChange={(e) => set({ dailyStart: e.target.value })} dir="ltr" className="w-36" />
          </Field>
          <Field label={t("lateCutoff")} help={t("lateCutoffHelp")}>
            <Input type="number" min={0} max={240} value={Number.isFinite(s.lateCutoffMin) ? s.lateCutoffMin : ""} onChange={(e) => set({ lateCutoffMin: num(e.target.value) })} dir="ltr" className="w-28" />
          </Field>
          <Field label={t("closeTime")} help={t("closeTimeHelp")}>
            <Input type="time" value={s.closeTime} onChange={(e) => set({ closeTime: e.target.value })} dir="ltr" className="w-36" />
          </Field>
          <Field label={t("followUpTime")} help={t("followUpTimeHelp")}>
            <Input type="time" value={s.followUpTime} onChange={(e) => set({ followUpTime: e.target.value })} dir="ltr" className="w-36" />
          </Field>
        </div>
        <label className="flex items-start justify-between gap-4 rounded-lg border p-3">
          <span>
            <span className="block text-sm font-medium">{t("autoNotify")}</span>
            <span className="block text-xs text-muted-foreground">{t("autoNotifyHelp")}</span>
          </span>
          <Switch checked={s.autoNotify} onCheckedChange={(c) => set({ autoNotify: c })} aria-label={t("autoNotify")} />
        </label>
      </section>

      <section className={section}>
        <div>
          <h2 className="text-sm font-semibold">{t("dailyOnlyTitle")}</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">{t("dailyOnlyBody")}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {grades.map((g) => {
            const on = s.dailyOnlyGrades.includes(g.value);
            return (
              <label key={g.value} className={cn("flex cursor-pointer items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium", on ? "border-brand bg-brand-soft text-brand" : "text-muted-foreground")}>
                <Checkbox checked={on} onCheckedChange={(c) => set({ dailyOnlyGrades: c ? [...s.dailyOnlyGrades, g.value] : s.dailyOnlyGrades.filter((x) => x !== g.value) })} />
                {g.label}
              </label>
            );
          })}
        </div>
      </section>

      <section className={section}>
        <h2 className="text-sm font-semibold">{t("persistentTitle")}</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("threshold")} help={t("thresholdHelp")}>
            <div className="flex items-center gap-1.5">
              <Input type="number" min={50} max={100} step="0.5" value={Number.isFinite(s.persistentThreshold) ? s.persistentThreshold : ""} onChange={(e) => set({ persistentThreshold: num(e.target.value) })} dir="ltr" className="w-24" />
              <span className="text-sm text-muted-foreground">%</span>
            </div>
          </Field>
          <Field label={t("minDays")} help={t("minDaysHelp")}>
            <Input type="number" min={1} max={200} value={Number.isFinite(s.persistentMinDays) ? s.persistentMinDays : ""} onChange={(e) => set({ persistentMinDays: num(e.target.value) })} dir="ltr" className="w-24" />
          </Field>
        </div>
        <div>
          <h3 className="text-xs font-semibold">{t("headsTitle")}</h3>
          <p className="mb-2 text-xs text-muted-foreground">{t("headsBody")}</p>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {grades.map((g) => (
              <div key={g.value} className="flex items-center gap-2">
                <span className="w-24 shrink-0 text-xs font-medium">{g.label}</span>
                <Select
                  value={s.headsOfYear[String(g.value)]?.[0] ?? "none"}
                  onValueChange={(v) => {
                    const next = { ...s.headsOfYear };
                    if (v === "none") delete next[String(g.value)];
                    else next[String(g.value)] = [v];
                    set({ headsOfYear: next });
                  }}
                >
                  <SelectTrigger className="h-9 w-full" aria-label={t("headFor", { grade: g.label })}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">{t("noHead")}</SelectItem>
                    {staff.map((m) => (
                      <SelectItem key={m.id} value={m.id}>
                        {m.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className={section} data-testid="limit-settings">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-2">
            <ShieldAlert className="mt-0.5 size-4 text-muted-foreground" />
            <div>
              <h2 className="text-sm font-semibold">{t("limitTitle")}</h2>
              <p className="mt-0.5 text-xs text-muted-foreground">{t("limitBody")}</p>
            </div>
          </div>
          <Switch checked={s.limitEnabled} onCheckedChange={(c) => set({ limitEnabled: c })} aria-label={t("limitTitle")} data-testid="limit-enabled" />
        </div>
        {s.limitEnabled && (
          <>
            <Button type="button" variant="outline" size="sm" onClick={() => set(SHARJAH)} data-testid="preset-sharjah">
              {t("presetSharjah")}
            </Button>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label={t("limitConsecutive")}>
                <Input type="number" min={2} max={100} value={Number.isFinite(s.limitConsecutive) ? s.limitConsecutive : ""} onChange={(e) => set({ limitConsecutive: num(e.target.value) })} dir="ltr" className="w-24" />
              </Field>
              <Field label={t("limitTotal")}>
                <Input type="number" min={2} max={200} value={Number.isFinite(s.limitTotal) ? s.limitTotal : ""} onChange={(e) => set({ limitTotal: num(e.target.value) })} dir="ltr" className="w-24" />
              </Field>
              <Field label={t("limitWarn")} help={t("limitWarnHelp")}>
                <div className="flex items-center gap-1.5">
                  <Input type="number" min={30} max={95} value={Number.isFinite(s.limitWarnPct) ? s.limitWarnPct : ""} onChange={(e) => set({ limitWarnPct: num(e.target.value) })} dir="ltr" className="w-24" />
                  <span className="text-sm text-muted-foreground">%</span>
                </div>
              </Field>
            </div>
            <p className="text-xs text-muted-foreground">{t("limitSource")}</p>
          </>
        )}
      </section>

      {error && (
        <p className="text-sm text-danger" role="alert">
          {error}
        </p>
      )}
      <div className="flex justify-end">
        <Button onClick={save} disabled={pending} data-testid="save-settings">
          {pending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
          {t("save")}
        </Button>
      </div>
    </div>
  );
}

function Field({ label, help, children }: { label: string; help?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs font-medium">{label}</Label>
      {children}
      {help && <p className="text-xs text-muted-foreground">{help}</p>}
    </div>
  );
}

export type CodeRow = {
  code: string;
  labelEn: string;
  labelAr: string;
  countsAs: "PRESENT" | "ABSENT" | "NOT_COUNTED";
  authorised: boolean;
  late: boolean;
  category: string;
  private: boolean;
  quick: string | null;
  active: boolean;
  isNew?: boolean;
};

export function CodesEditor({ initial, categories, custom }: { initial: CodeRow[]; categories: string[]; custom: boolean }) {
  const t = useTranslations("attendance.codes");
  const router = useRouter();
  const [rows, setRows] = useState<CodeRow[]>(initial);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const upd = (i: number, patch: Partial<CodeRow>) => setRows((r) => r.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const save = () =>
    start(async () => {
      setError(null);
      const res = await saveCodesAction(rows.map(({ isNew: _n, ...r }) => r));
      if (!res.ok) return setError(t.has(`error.${res.error}`) ? t(`error.${res.error}`) : t("error.generic"));
      toast.success(t("saved"));
      router.refresh();
    });
  return (
    <div className="space-y-4" data-testid="codes-editor">
      <p className="text-xs text-muted-foreground">{custom ? t("custom") : t("defaults")}</p>
      <div className="overflow-x-auto rounded-xl border bg-card shadow-xs">
        <table className="w-full min-w-[980px] text-sm">
          <thead className="bg-muted/40 text-xs text-muted-foreground">
            <tr>
              <th className="px-2 py-2 text-start font-medium">{t("colCode")}</th>
              <th className="px-2 py-2 text-start font-medium">{t("colLabelEn")}</th>
              <th className="px-2 py-2 text-start font-medium">{t("colLabelAr")}</th>
              <th className="px-2 py-2 text-start font-medium">{t("colCountsAs")}</th>
              <th className="px-2 py-2 text-start font-medium">{t("colCategory")}</th>
              <th className="px-2 py-2 text-center font-medium">{t("colAuthorised")}</th>
              <th className="px-2 py-2 text-center font-medium">{t("colLate")}</th>
              <th className="px-2 py-2 text-center font-medium">{t("colPrivate")}</th>
              <th className="px-2 py-2 text-start font-medium">{t("colQuick")}</th>
              <th className="px-2 py-2 text-center font-medium">{t("colActive")}</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.map((r, i) => (
              <tr key={i} className={cn(!r.active && "opacity-60")} data-testid="code-row">
                <td className="px-2 py-1.5">
                  <Input value={r.code} maxLength={4} disabled={!r.isNew} onChange={(e) => upd(i, { code: e.target.value.toUpperCase() })} dir="ltr" className="h-8 w-16 font-semibold" aria-label={t("colCode")} />
                </td>
                <td className="px-2 py-1.5">
                  <Input value={r.labelEn} maxLength={80} onChange={(e) => upd(i, { labelEn: e.target.value })} dir="ltr" className="h-8 min-w-44" aria-label={t("colLabelEn")} />
                </td>
                <td className="px-2 py-1.5">
                  <Input value={r.labelAr} maxLength={80} onChange={(e) => upd(i, { labelAr: e.target.value })} dir="rtl" className="h-8 min-w-44" aria-label={t("colLabelAr")} />
                </td>
                <td className="px-2 py-1.5">
                  <Select value={r.countsAs} onValueChange={(v) => upd(i, { countsAs: v as CodeRow["countsAs"], ...(v !== "ABSENT" ? { authorised: false } : {}), ...(v !== "PRESENT" ? { late: false } : {}) })}>
                    <SelectTrigger className="h-8 w-36" aria-label={t("colCountsAs")}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(["PRESENT", "ABSENT", "NOT_COUNTED"] as const).map((c) => (
                        <SelectItem key={c} value={c}>
                          {t(`countsAs.${c}`)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </td>
                <td className="px-2 py-1.5">
                  <Select value={r.category} onValueChange={(v) => upd(i, { category: v })}>
                    <SelectTrigger className="h-8 w-40" aria-label={t("colCategory")}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {categories.map((c) => (
                        <SelectItem key={c} value={c}>
                          {t(`category.${c}`)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </td>
                <td className="px-2 py-1.5 text-center">
                  <Checkbox checked={r.authorised} disabled={r.countsAs !== "ABSENT"} onCheckedChange={(c) => upd(i, { authorised: !!c })} aria-label={t("colAuthorised")} />
                </td>
                <td className="px-2 py-1.5 text-center">
                  <Checkbox checked={r.late} disabled={r.countsAs !== "PRESENT"} onCheckedChange={(c) => upd(i, { late: !!c })} aria-label={t("colLate")} />
                </td>
                <td className="px-2 py-1.5 text-center">
                  <Checkbox checked={r.private} onCheckedChange={(c) => upd(i, { private: !!c })} aria-label={t("colPrivate")} />
                </td>
                <td className="px-2 py-1.5">
                  <Select value={r.quick ?? "none"} onValueChange={(v) => upd(i, { quick: v === "none" ? null : v })}>
                    <SelectTrigger className="h-8 w-32" aria-label={t("colQuick")}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">{t("quickNone")}</SelectItem>
                      {["present", "late", "absent", "excused", "activity"].map((q) => (
                        <SelectItem key={q} value={q}>
                          {t(`quick.${q}`)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </td>
                <td className="px-2 py-1.5 text-center">
                  <Switch checked={r.active} onCheckedChange={(c) => upd(i, { active: c })} aria-label={t("colActive")} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted-foreground">{t("help")}</p>
      {error && (
        <p className="text-sm text-danger" role="alert">
          {error}
        </p>
      )}
      <div className="flex flex-wrap justify-between gap-2">
        <Button variant="outline" onClick={() => setRows([...rows, { code: "", labelEn: "", labelAr: "", countsAs: "ABSENT", authorised: true, late: false, category: "authorised", private: false, quick: null, active: true, isNew: true }])} disabled={rows.length >= 40}>
          <Plus className="size-4" />
          {t("add")}
        </Button>
        <Button onClick={save} disabled={pending} data-testid="save-codes">
          {pending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
          {t("save")}
        </Button>
      </div>
    </div>
  );
}
