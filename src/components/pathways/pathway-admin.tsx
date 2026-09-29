"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Download, Loader2, Pencil, Plus, ShieldCheck } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  markProgramCheckedAction,
  runScorecardImportAction,
  saveProgramAction,
  saveUniversityAction,
} from "@/server/pathways/actions";

type Opt = { value: string; label: string };

function Field({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("min-w-0 space-y-1", className)}>
      <Label className="text-xs">{label}</Label>
      {children}
    </div>
  );
}

function Pick({
  value,
  onChange,
  options,
  testId,
}: {
  value: string;
  onChange: (v: string) => void;
  options: Opt[];
  testId?: string;
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="w-full" data-testid={testId}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export type UniversityForm = {
  id: string | null;
  nameEn: string;
  nameAr: string;
  countryCode: string;
  cityEn: string;
  cityAr: string;
  website: string;
  applyVia: string;
  deadlineMonth: string;
};

export function UniversityDialog({
  initial,
  routes,
  months,
}: {
  initial: UniversityForm | null;
  routes: Opt[];
  months: Opt[];
}) {
  const t = useTranslations("pathways.admin");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const blank: UniversityForm = {
    id: null,
    nameEn: "",
    nameAr: "",
    countryCode: "",
    cityEn: "",
    cityAr: "",
    website: "",
    applyVia: "none",
    deadlineMonth: "none",
  };
  const [f, setF] = useState<UniversityForm>(initial ?? blank);
  const [pending, start] = useTransition();
  const set = (k: keyof UniversityForm) => (v: string) =>
    setF((x) => ({ ...x, [k]: v }));
  const valid =
    f.nameEn.trim().length > 1 &&
    f.nameAr.trim().length > 1 &&
    /^[A-Za-z]{2}$/.test(f.countryCode.trim()) &&
    f.cityEn.trim() &&
    f.cityAr.trim();
  return (
    <>
      {initial ? (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setOpen(true)}
          data-testid="edit-university"
        >
          <Pencil className="size-3.5" />
          {t("edit")}
        </Button>
      ) : (
        <Button
          variant="outline"
          size="sm"
          onClick={() => setOpen(true)}
          data-testid="new-university"
        >
          <Plus className="size-4" />
          {t("newUniversity")}
        </Button>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {initial ? t("editUniversity") : t("newUniversity")}
            </DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t("nameEn")}>
              <Input
                value={f.nameEn}
                onChange={(e) => set("nameEn")(e.target.value)}
                data-testid="uni-name-en"
              />
            </Field>
            <Field label={t("nameAr")}>
              <Input
                dir="rtl"
                value={f.nameAr}
                onChange={(e) => set("nameAr")(e.target.value)}
                data-testid="uni-name-ar"
              />
            </Field>
            <Field label={t("countryCode")}>
              <Input
                value={f.countryCode}
                maxLength={2}
                onChange={(e) =>
                  set("countryCode")(e.target.value.toUpperCase())
                }
                placeholder={t("countryHint")}
                data-testid="uni-country"
              />
            </Field>
            <Field label={t("website")}>
              <Input
                value={f.website}
                onChange={(e) => set("website")(e.target.value)}
              />
            </Field>
            <Field label={t("cityEn")}>
              <Input
                value={f.cityEn}
                onChange={(e) => set("cityEn")(e.target.value)}
                data-testid="uni-city-en"
              />
            </Field>
            <Field label={t("cityAr")}>
              <Input
                dir="rtl"
                value={f.cityAr}
                onChange={(e) => set("cityAr")(e.target.value)}
                data-testid="uni-city-ar"
              />
            </Field>
            <Field label={t("route")}>
              <Pick
                value={f.applyVia}
                onChange={set("applyVia")}
                options={[{ value: "none", label: t("notSet") }, ...routes]}
              />
            </Field>
            <Field label={t("deadlineMonth")}>
              <Pick
                value={f.deadlineMonth}
                onChange={set("deadlineMonth")}
                options={[{ value: "none", label: t("notSet") }, ...months]}
              />
            </Field>
          </div>
          <Button
            disabled={pending || !valid}
            data-testid="save-university"
            onClick={() =>
              start(async () => {
                const res = await saveUniversityAction({
                  id: f.id,
                  nameEn: f.nameEn,
                  nameAr: f.nameAr,
                  countryCode: f.countryCode,
                  cityEn: f.cityEn,
                  cityAr: f.cityAr,
                  website: f.website.trim() || null,
                  applyVia:
                    f.applyVia === "none" ? null : (f.applyVia as never),
                  deadlineMonth:
                    f.deadlineMonth === "none" ? null : Number(f.deadlineMonth),
                });
                if (res.ok) {
                  toast.success(t("saved"));
                  setOpen(false);
                  router.refresh();
                } else toast.error(t("invalid"));
              })
            }
          >
            {pending && <Loader2 className="size-4 animate-spin" />}
            {t("save")}
          </Button>
        </DialogContent>
      </Dialog>
    </>
  );
}

export type ProgramForm = {
  id: string | null;
  universityId: string;
  nameEn: string;
  nameAr: string;
  field: string;
  degree: string;
  durationYears: string;
  requiredSubjects: string[];
  recommendedSubjects: string[];
  requirementsJson: string;
  englishJson: string;
  notesEn: string;
  notesAr: string;
  sourceUrl: string;
};

export function ProgramDialog({
  initial,
  universities,
  fields,
  degrees,
  subjects,
  example,
}: {
  initial: ProgramForm | null;
  universities: Opt[];
  fields: Opt[];
  degrees: Opt[];
  subjects: Opt[];
  example: string;
}) {
  const t = useTranslations("pathways.admin");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const blank: ProgramForm = {
    id: null,
    universityId: universities[0]?.value ?? "",
    nameEn: "",
    nameAr: "",
    field: fields[0]?.value ?? "",
    degree: degrees[0]?.value ?? "",
    durationYears: "3",
    requiredSubjects: [],
    recommendedSubjects: [],
    requirementsJson: example,
    englishJson: "",
    notesEn: "",
    notesAr: "",
    sourceUrl: "",
  };
  const [f, setF] = useState<ProgramForm>(initial ?? blank);
  const [checkedNow, setCheckedNow] = useState(false);
  const [pending, start] = useTransition();
  const set =
    <K extends keyof ProgramForm>(k: K) =>
    (v: ProgramForm[K]) =>
      setF((x) => ({ ...x, [k]: v }));
  const toggle = (
    k: "requiredSubjects" | "recommendedSubjects",
    code: string,
  ) =>
    setF((x) => ({
      ...x,
      [k]: x[k].includes(code)
        ? x[k].filter((c) => c !== code)
        : [...x[k], code],
    }));
  const valid =
    f.nameEn.trim().length > 1 &&
    f.nameAr.trim().length > 1 &&
    !!f.universityId &&
    Number(f.durationYears) >= 1;
  return (
    <>
      {initial ? (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setOpen(true)}
          data-testid="edit-program"
        >
          <Pencil className="size-3.5" />
          {t("edit")}
        </Button>
      ) : (
        <Button
          size="sm"
          onClick={() => setOpen(true)}
          data-testid="new-program"
        >
          <Plus className="size-4" />
          {t("newProgram")}
        </Button>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {initial ? t("editProgram") : t("newProgram")}
            </DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t("university")} className="sm:col-span-2">
              <Pick
                value={f.universityId}
                onChange={set("universityId")}
                options={universities}
                testId="program-university"
              />
            </Field>
            <Field label={t("nameEn")}>
              <Input
                value={f.nameEn}
                onChange={(e) => set("nameEn")(e.target.value)}
                data-testid="program-name-en"
              />
            </Field>
            <Field label={t("nameAr")}>
              <Input
                dir="rtl"
                value={f.nameAr}
                onChange={(e) => set("nameAr")(e.target.value)}
                data-testid="program-name-ar"
              />
            </Field>
            <Field label={t("field")}>
              <Pick value={f.field} onChange={set("field")} options={fields} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label={t("degree")}>
                <Pick
                  value={f.degree}
                  onChange={set("degree")}
                  options={degrees}
                />
              </Field>
              <Field label={t("years")}>
                <Input
                  inputMode="decimal"
                  value={f.durationYears}
                  onChange={(e) => set("durationYears")(e.target.value)}
                />
              </Field>
            </div>
            {(["requiredSubjects", "recommendedSubjects"] as const).map((k) => (
              <Field key={k} label={t(k)} className="sm:col-span-2">
                <div className="flex flex-wrap gap-1.5">
                  {subjects.map((s) => (
                    <button
                      type="button"
                      key={s.value}
                      onClick={() => toggle(k, s.value)}
                      className={cn(
                        "rounded-full border px-2.5 py-1 text-xs",
                        f[k].includes(s.value)
                          ? "border-brand bg-brand text-brand-foreground"
                          : "hover:bg-muted",
                      )}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
              </Field>
            ))}
            <Field label={t("requirementsJson")} className="sm:col-span-2">
              <Textarea
                dir="ltr"
                rows={8}
                className="font-mono text-xs"
                value={f.requirementsJson}
                onChange={(e) => set("requirementsJson")(e.target.value)}
                data-testid="program-requirements"
              />
              <p className="text-[11px] text-muted-foreground">
                {t("requirementsHint")}
              </p>
            </Field>
            <Field label={t("englishJson")} className="sm:col-span-2">
              <Textarea
                dir="ltr"
                rows={2}
                className="font-mono text-xs"
                value={f.englishJson}
                onChange={(e) => set("englishJson")(e.target.value)}
                placeholder='{"ielts": 6.5, "ieltsMinBand": 6, "toefl": 90}'
              />
            </Field>
            <Field label={t("notesEn")}>
              <Textarea
                rows={2}
                value={f.notesEn}
                onChange={(e) => set("notesEn")(e.target.value)}
              />
            </Field>
            <Field label={t("notesAr")}>
              <Textarea
                dir="rtl"
                rows={2}
                value={f.notesAr}
                onChange={(e) => set("notesAr")(e.target.value)}
              />
            </Field>
            <Field label={t("sourceUrl")} className="sm:col-span-2">
              <Input
                dir="ltr"
                value={f.sourceUrl}
                onChange={(e) => set("sourceUrl")(e.target.value)}
                placeholder="https://"
                data-testid="program-source"
              />
            </Field>
            <label className="flex items-start gap-2 text-sm sm:col-span-2">
              <Checkbox
                checked={checkedNow}
                disabled={!f.sourceUrl.trim()}
                onCheckedChange={(c) => setCheckedNow(c === true)}
                className="mt-0.5"
              />
              <span>
                {t("checkedNow")}
                <span className="block text-xs text-muted-foreground">
                  {t("checkedNowHint")}
                </span>
              </span>
            </label>
          </div>
          <Button
            disabled={pending || !valid}
            data-testid="save-program"
            onClick={() =>
              start(async () => {
                const res = await saveProgramAction({
                  id: f.id,
                  universityId: f.universityId,
                  nameEn: f.nameEn,
                  nameAr: f.nameAr,
                  field: f.field as never,
                  degree: f.degree as never,
                  durationYears: Number(f.durationYears),
                  requiredSubjects: f.requiredSubjects as never,
                  recommendedSubjects: f.recommendedSubjects as never,
                  requirementsJson: f.requirementsJson,
                  englishJson: f.englishJson,
                  notesEn: f.notesEn || null,
                  notesAr: f.notesAr || null,
                  sourceUrl: f.sourceUrl.trim() || null,
                  checkedNow,
                });
                if (res.ok) {
                  toast.success(t("saved"));
                  setOpen(false);
                  router.refresh();
                } else
                  toast.error(
                    res.error === "requirementsJson"
                      ? t("badRequirements")
                      : res.error === "englishJson"
                        ? t("badEnglish")
                        : t("invalid"),
                  );
              })
            }
          >
            {pending && <Loader2 className="size-4 animate-spin" />}
            {t("save")}
          </Button>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function MarkCheckedButton({
  programId,
  hasSource,
}: {
  programId: string;
  hasSource: boolean;
}) {
  const t = useTranslations("pathways.admin");
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <span
      title={hasSource ? t("markCheckedHint") : t("needsSource")}
      className="inline-flex"
    >
      <Button
        variant="outline"
        size="sm"
        disabled={pending || !hasSource}
        data-testid="mark-checked"
        onClick={() =>
          start(async () => {
            const res = await markProgramCheckedAction(programId);
            if (res.ok) toast.success(t("markedChecked"));
            else toast.error(t("invalid"));
            router.refresh();
          })
        }
      >
        {pending ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <ShieldCheck className="size-4" />
        )}
        {t("markChecked")}
      </Button>
    </span>
  );
}

export function ImportButton() {
  const t = useTranslations("pathways.admin");
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      size="sm"
      disabled={pending}
      data-testid="run-import"
      onClick={() =>
        start(async () => {
          const res = await runScorecardImportAction();
          if (res.ok)
            toast.success(
              t("importDone", {
                created: res.created,
                updated: res.updated,
                linked: res.linked,
              }),
            );
          else toast.error(t(`importError.${res.error}`));
          router.refresh();
        })
      }
    >
      {pending ? (
        <Loader2 className="size-4 animate-spin" />
      ) : (
        <Download className="size-4" />
      )}
      {pending ? t("importing") : t("runImport")}
    </Button>
  );
}
