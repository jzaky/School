"use client";

import { useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { AlertTriangle, Check, ChevronLeft, ChevronRight, Info, Loader2, Plus, Save, Send, Trash2 } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { gradeLevelValues } from "@/lib/grade-levels";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { saveStepAction, submitApplicationAction } from "@/server/admissions/apply-actions";
import { ageFlag, birthRangeFor } from "@/server/admissions/rules";
import { RELATIONSHIPS } from "@/server/admissions/config";
import { DocumentUploads, type DocRow, type DocTypeOpt } from "./apply-docs";
import { Field, selectClass } from "./ui";

type Step = "student" | "schooling" | "family" | "health" | "documents" | "review";
const ORDER: Step[] = ["student", "schooling", "family", "health", "documents", "review"];

type StudentV = { academicYearId: string; gradeLevel: number; curriculum: string | null; firstNameEn: string; lastNameEn: string; firstNameAr: string; lastNameAr: string; dateOfBirth: string; gender: string; nationality: string; homeLanguage: string; emiratesId: string; passport: string };
type SchoolingV = { attended: boolean; schoolName?: string; city?: string; country?: string; curriculum?: string; lastGrade?: string; fromYear?: number | null; toYear?: number | null; leavingReason?: string };
type GuardianV = { relationship: string; firstNameEn: string; lastNameEn: string; firstNameAr: string; lastNameAr: string; email: string; phone: string; occupation: string; employer: string; livesWith: boolean; primary: boolean };
type SiblingV = { name: string; gradeLevel: number | null; studentNo: string };
type FamilyV = { guardians: GuardianV[]; siblings: SiblingV[]; staffChild: boolean };
type HealthV = { allergies: string; conditions: string; medications: string; supportNeeded: boolean; supportDetails: string; previousAssessment: boolean };

export type WizardForm = { student: StudentV; schooling: SchoolingV | null; family: FamilyV | null; health: HealthV };
type YearOpt = { id: string; name: string; entryYear: number; grades: number[] };

const emptyGuardian = (primary: boolean): GuardianV => ({ relationship: "MOTHER", firstNameEn: "", lastNameEn: "", firstNameAr: "", lastNameAr: "", email: "", phone: "", occupation: "", employer: "", livesWith: true, primary });

/** 784-YYYY-NNNNNNN-N as the family types. */
function formatEidInput(raw: string) {
  const d = raw.replace(/\D/g, "").slice(0, 15);
  const parts = [d.slice(0, 3), d.slice(3, 7), d.slice(7, 14), d.slice(14, 15)].filter(Boolean);
  return parts.join("-");
}

export function ApplyWizard(props: {
  slug: string;
  applicationId: string;
  number: string;
  initialStep: Step | null;
  saved: string[];
  form: WizardForm;
  years: YearOpt[];
  curricula: string[];
  cutoff: { month: number; day: number };
  countries: Array<{ code: string; name: string }>;
  languages: Array<{ code: string; name: string }>;
  docTypes: DocTypeOpt[];
  docs: DocRow[];
}) {
  const t = useTranslations("admissions.form");
  const tw = useTranslations("admissions.wizard");
  const tg = useTranslations("gradeLevel");
  const trel = useTranslations("admissions.relationship");
  const locale = useLocale();
  const router = useRouter();
  const [saved, setSaved] = useState<Set<string>>(new Set(props.saved));
  const firstOpen = ORDER.find((s) => s !== "documents" && s !== "review" && !props.saved.includes(s)) ?? "documents";
  const [step, setStep] = useState<Step>(props.initialStep ?? firstOpen);
  const [errors, setErrors] = useState<string[]>([]);
  const [pending, start] = useTransition();

  const [student, setStudent] = useState<StudentV>({ ...props.form.student, emiratesId: props.form.student.emiratesId ? formatEidInput(props.form.student.emiratesId) : "" });
  const [schooling, setSchooling] = useState<SchoolingV>(props.form.schooling ?? { attended: props.form.student.gradeLevel > 0 });
  const [family, setFamily] = useState<FamilyV>(props.form.family ?? { guardians: [emptyGuardian(true)], siblings: [], staffChild: false });
  const [health, setHealth] = useState<HealthV>(props.form.health);
  const [consent, setConsent] = useState(false);

  const year = props.years.find((y) => y.id === student.academicYearId) ?? props.years[0];
  const dob = /^\d{4}-\d{2}-\d{2}$/.test(student.dateOfBirth) ? new Date(`${student.dateOfBirth}T00:00:00Z`) : null;
  const age = year && dob ? ageFlag(dob, student.gradeLevel, year.entryYear, props.cutoff) : null;
  const range = year ? birthRangeFor(student.gradeLevel, year.entryYear, props.cutoff) : null;
  const fmt = (d: Date) => new Intl.DateTimeFormat(locale === "ar" ? "ar-AE-u-nu-latn" : "en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(d);
  const bad = (path: string) => errors.some((e) => e === path || e.startsWith(`${path}.`));
  const errMsg = (path: string, msg?: string) => (bad(path) ? (msg ?? t("checkField")) : undefined);

  const go = (s: Step) => {
    setErrors([]);
    setStep(s);
    router.replace(`/apply/${props.slug}/${props.applicationId}?step=${s}`, { scroll: false });
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const dataFor = (s: Step): unknown => {
    if (s === "student") return { ...student, curriculum: student.curriculum || null, emiratesId: student.emiratesId.replace(/\s/g, "") };
    if (s === "schooling") return schooling.attended ? { ...schooling, attended: true, fromYear: schooling.fromYear || null, toYear: schooling.toYear || null } : { attended: false };
    if (s === "family") return family;
    return health;
  };

  const save = (s: Step, then: "next" | "later") =>
    start(async () => {
      setErrors([]);
      const r = await saveStepAction({ slug: props.slug, locale, applicationId: props.applicationId, step: s, data: dataFor(s) });
      if (!r.ok) {
        if (r.fields) setErrors(r.fields);
        const dup = r.error.startsWith("DUPLICATE_OWN:") ? r.error.split(":")[1] : null;
        return void toast.error(dup ? tw("duplicateOwn", { number: dup }) : tw.has(`errors.${r.error}`) ? tw(`errors.${r.error}`) : tw("errors.generic"));
      }
      setSaved((x) => new Set([...x, s]));
      if (then === "later") {
        toast.success(tw("savedLater"));
        router.push(`/apply/${props.slug}`);
        return;
      }
      // Moving to the next step is the confirmation; a toast here would cover the buttons on a phone.
      go(ORDER[ORDER.indexOf(s) + 1]);
    });

  const submit = () =>
    start(async () => {
      const r = await submitApplicationAction({ slug: props.slug, locale, applicationId: props.applicationId, consent });
      if (!r.ok) {
        const missing = r.error.startsWith("INCOMPLETE:") ? r.error.split(":")[1].split(",") : [];
        return void toast.error(missing.length ? tw("incomplete", { steps: missing.map((m) => tw(`steps.${m}`)).join(", ") }) : tw.has(`errors.${r.error}`) ? tw(`errors.${r.error}`) : tw("errors.generic"));
      }
      toast.success(tw("submitted"));
      router.refresh();
    });

  const missingRequired = props.docTypes.filter((d) => d.required && !props.docs.some((x) => x.typeKey === d.key && x.status !== "REJECTED"));
  const stepDone = (s: Step) => (s === "documents" ? missingRequired.length === 0 && saved.has("health") : saved.has(s));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-xl font-semibold tracking-tight">{tw("title")}</h1>
        <span className="text-xs text-muted-foreground" dir="ltr">
          {props.number}
        </span>
      </div>
      <nav className="-mx-4 overflow-x-auto px-4" aria-label={tw("stepsLabel")}>
        <ol className="flex min-w-max gap-1.5">
          {ORDER.map((s, i) => (
            <li key={s}>
              <button
                type="button"
                onClick={() => go(s)}
                className={cn("flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition", step === s ? "border-brand bg-brand text-brand-foreground" : stepDone(s) ? "border-success/30 bg-success-soft text-success" : "bg-card text-muted-foreground hover:text-foreground")}
                aria-current={step === s ? "step" : undefined}
                data-testid={`step-${s}`}
              >
                {stepDone(s) && step !== s ? <Check className="size-3.5" /> : <span className="tabular-nums">{i + 1}</span>}
                {tw(`steps.${s}`)}
              </button>
            </li>
          ))}
        </ol>
      </nav>

      <section className="rounded-2xl border bg-card p-4 shadow-sm sm:p-6" data-testid={`wizard-${step}`}>
        {step === "student" && (
          <div className="space-y-4">
            <StepHead title={tw("steps.student")} body={tw("studentIntro")} />
            <div className="grid gap-3 sm:grid-cols-2">
              <Field id="year" label={t("yearOfEntry")} error={errMsg("academicYearId")}>
                <select id="year" className={selectClass} value={student.academicYearId} onChange={(e) => setStudent({ ...student, academicYearId: e.target.value })}>
                  {props.years.map((y) => (
                    <option key={y.id} value={y.id}>
                      {y.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field id="grade" label={t("grade")} error={errMsg("gradeLevel")}>
                <select id="grade" className={selectClass} value={student.gradeLevel} onChange={(e) => setStudent({ ...student, gradeLevel: Number(e.target.value) })} data-testid="f-grade">
                  {(year?.grades ?? []).map((g) => (
                    <option key={g} value={g}>
                      {tg("label", gradeLevelValues(g))}
                    </option>
                  ))}
                </select>
              </Field>
              {props.curricula.length > 1 && (
                <Field id="curriculum" label={t("track")} className="sm:col-span-2">
                  <select id="curriculum" className={selectClass} value={student.curriculum ?? ""} onChange={(e) => setStudent({ ...student, curriculum: e.target.value || null })}>
                    <option value="">{t("trackAny")}</option>
                    {props.curricula.map((c) => (
                      <option key={c} value={c}>
                        {t(`curriculum.${c}`)}
                      </option>
                    ))}
                  </select>
                </Field>
              )}
              <Field id="fnEn" label={t("firstNameEn")} error={errMsg("firstNameEn")}>
                <Input id="fnEn" dir="ltr" autoComplete="off" value={student.firstNameEn} onChange={(e) => setStudent({ ...student, firstNameEn: e.target.value })} aria-invalid={bad("firstNameEn")} data-testid="f-firstNameEn" />
              </Field>
              <Field id="lnEn" label={t("lastNameEn")} error={errMsg("lastNameEn")}>
                <Input id="lnEn" dir="ltr" autoComplete="off" value={student.lastNameEn} onChange={(e) => setStudent({ ...student, lastNameEn: e.target.value })} aria-invalid={bad("lastNameEn")} data-testid="f-lastNameEn" />
              </Field>
              <Field id="fnAr" label={t("firstNameAr")} optional hint={t("arabicNameHint")}>
                <Input id="fnAr" dir="rtl" autoComplete="off" value={student.firstNameAr} onChange={(e) => setStudent({ ...student, firstNameAr: e.target.value })} data-testid="f-firstNameAr" />
              </Field>
              <Field id="lnAr" label={t("lastNameAr")} optional>
                <Input id="lnAr" dir="rtl" autoComplete="off" value={student.lastNameAr} onChange={(e) => setStudent({ ...student, lastNameAr: e.target.value })} data-testid="f-lastNameAr" />
              </Field>
              <Field id="dob" label={t("dateOfBirth")} error={errMsg("dateOfBirth")} hint={range ? t("usualBirth", { grade: tg("label", gradeLevelValues(student.gradeLevel)), from: fmt(new Date(range.from.getTime() + 86_400_000)), to: fmt(range.to) }) : undefined}>
                <Input id="dob" type="date" dir="ltr" value={student.dateOfBirth} onChange={(e) => setStudent({ ...student, dateOfBirth: e.target.value })} aria-invalid={bad("dateOfBirth")} data-testid="f-dob" />
              </Field>
              <Field id="gender" label={t("gender")} error={errMsg("gender")}>
                <div className="grid grid-cols-2 gap-2" role="radiogroup" id="gender">
                  {(["F", "M"] as const).map((g) => (
                    <button key={g} type="button" role="radio" aria-checked={student.gender === g} onClick={() => setStudent({ ...student, gender: g })} className={cn("h-10 rounded-md border text-sm font-medium transition", student.gender === g ? "border-brand bg-brand-soft text-brand" : "bg-card hover:bg-muted")} data-testid={`f-gender-${g}`}>
                      {t(g === "F" ? "girl" : "boy")}
                    </button>
                  ))}
                </div>
              </Field>
              {age?.flag && (
                <p className="flex items-start gap-2 rounded-lg bg-warning-soft px-3 py-2 text-xs text-[oklch(0.5_0.13_65)] sm:col-span-2" data-testid="age-warning">
                  <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                  {t("ageOutside", { grade: tg("label", gradeLevelValues(student.gradeLevel)) })}
                </p>
              )}
              <Field id="nationality" label={t("nationality")} error={errMsg("nationality")}>
                <select id="nationality" className={selectClass} value={student.nationality} onChange={(e) => setStudent({ ...student, nationality: e.target.value })} data-testid="f-nationality">
                  <option value="" disabled>
                    {t("choose")}
                  </option>
                  {props.countries.map((c, i) => (
                    <option key={`${c.code}-${i}`} value={c.code}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field id="lang" label={t("homeLanguage")} optional>
                <select id="lang" className={selectClass} value={student.homeLanguage} onChange={(e) => setStudent({ ...student, homeLanguage: e.target.value })}>
                  <option value="">{t("choose")}</option>
                  {props.languages.map((l) => (
                    <option key={l.code} value={l.code}>
                      {l.code === "other" ? t("otherLanguage") : l.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field id="eid" label={t("emiratesId")} optional hint={t("emiratesIdHint")} error={errMsg("emiratesId", t("emiratesIdError"))}>
                <Input id="eid" dir="ltr" inputMode="numeric" placeholder="784-0000-0000000-0" value={student.emiratesId} onChange={(e) => setStudent({ ...student, emiratesId: formatEidInput(e.target.value) })} aria-invalid={bad("emiratesId")} data-testid="f-eid" />
              </Field>
              <Field id="passport" label={t("passport")} optional error={errMsg("passport", t("passportError"))}>
                <Input id="passport" dir="ltr" autoComplete="off" value={student.passport} onChange={(e) => setStudent({ ...student, passport: e.target.value.toUpperCase() })} aria-invalid={bad("passport")} data-testid="f-passport" />
              </Field>
            </div>
          </div>
        )}

        {step === "schooling" && (
          <div className="space-y-4">
            <StepHead title={tw("steps.schooling")} body={tw("schoolingIntro")} />
            <Field id="attended" label={t("attendedQuestion")}>
              <div className="grid grid-cols-2 gap-2" role="radiogroup" id="attended">
                {[true, false].map((v) => (
                  <button key={String(v)} type="button" role="radio" aria-checked={schooling.attended === v} onClick={() => setSchooling({ ...schooling, attended: v })} className={cn("h-10 rounded-md border text-sm font-medium transition", schooling.attended === v ? "border-brand bg-brand-soft text-brand" : "bg-card hover:bg-muted")} data-testid={`f-attended-${v}`}>
                    {t(v ? "yes" : "no")}
                  </button>
                ))}
              </div>
            </Field>
            {schooling.attended && (
              <div className="grid gap-3 sm:grid-cols-2">
                <Field id="sName" label={t("schoolName")} className="sm:col-span-2" error={errMsg("schoolName")}>
                  <Input id="sName" value={schooling.schoolName ?? ""} onChange={(e) => setSchooling({ ...schooling, schoolName: e.target.value })} aria-invalid={bad("schoolName")} data-testid="f-schoolName" />
                </Field>
                <Field id="sCity" label={t("city")} optional>
                  <Input id="sCity" value={schooling.city ?? ""} onChange={(e) => setSchooling({ ...schooling, city: e.target.value })} />
                </Field>
                <Field id="sCountry" label={t("country")} error={errMsg("country")}>
                  <select id="sCountry" className={selectClass} value={schooling.country ?? ""} onChange={(e) => setSchooling({ ...schooling, country: e.target.value })} data-testid="f-schoolCountry">
                    <option value="" disabled>
                      {t("choose")}
                    </option>
                    {props.countries.map((c, i) => (
                      <option key={`${c.code}-${i}`} value={c.code}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field id="sCurr" label={t("previousCurriculum")} optional>
                  <Input id="sCurr" value={schooling.curriculum ?? ""} onChange={(e) => setSchooling({ ...schooling, curriculum: e.target.value })} />
                </Field>
                <Field id="sGrade" label={t("lastGrade")} optional>
                  <Input id="sGrade" value={schooling.lastGrade ?? ""} onChange={(e) => setSchooling({ ...schooling, lastGrade: e.target.value })} />
                </Field>
                <Field id="sFrom" label={t("fromYear")} optional>
                  <Input id="sFrom" type="number" dir="ltr" inputMode="numeric" min={2000} max={2100} value={schooling.fromYear ?? ""} onChange={(e) => setSchooling({ ...schooling, fromYear: e.target.value ? Number(e.target.value) : null })} />
                </Field>
                <Field id="sTo" label={t("toYear")} optional>
                  <Input id="sTo" type="number" dir="ltr" inputMode="numeric" min={2000} max={2100} value={schooling.toYear ?? ""} onChange={(e) => setSchooling({ ...schooling, toYear: e.target.value ? Number(e.target.value) : null })} />
                </Field>
                <Field id="sReason" label={t("leavingReason")} optional className="sm:col-span-2">
                  <Textarea id="sReason" rows={2} maxLength={300} value={schooling.leavingReason ?? ""} onChange={(e) => setSchooling({ ...schooling, leavingReason: e.target.value })} />
                </Field>
              </div>
            )}
          </div>
        )}

        {step === "family" && (
          <div className="space-y-5">
            <StepHead title={tw("steps.family")} body={tw("familyIntro")} />
            {family.guardians.map((g, i) => {
              const set = (patch: Partial<GuardianV>) => setFamily({ ...family, guardians: family.guardians.map((x, j) => (j === i ? { ...x, ...patch } : patch.primary ? { ...x, primary: false } : x)) });
              const p = `guardians.${i}`;
              return (
                <fieldset key={i} className="space-y-3 rounded-xl border bg-muted/20 p-3 sm:p-4" data-testid={`guardian-${i}`}>
                  <div className="flex items-center justify-between gap-2">
                    <legend className="text-sm font-semibold">{t("guardianN", { n: i + 1 })}</legend>
                    {family.guardians.length > 1 && (
                      <Button type="button" variant="ghost" size="sm" onClick={() => setFamily({ ...family, guardians: family.guardians.filter((_, j) => j !== i).map((x, j) => ({ ...x, primary: x.primary || (j === 0 && g.primary) })) })} aria-label={t("remove")}>
                        <Trash2 className="size-4" />
                      </Button>
                    )}
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field id={`g${i}-rel`} label={t("relationshipLabel")}>
                      <select id={`g${i}-rel`} className={selectClass} value={g.relationship} onChange={(e) => set({ relationship: e.target.value })} data-testid={`g${i}-relationship`}>
                        {RELATIONSHIPS.map((r) => (
                          <option key={r} value={r}>
                            {trel(r)}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field id={`g${i}-primary`} label={t("primaryContact")}>
                      <label className="flex h-10 items-center gap-2 rounded-md border bg-card px-3 text-sm">
                        <input type="radio" name="primary" checked={g.primary} onChange={() => set({ primary: true })} className="accent-[var(--brand)]" />
                        {t("primaryContactYes")}
                      </label>
                    </Field>
                    <Field id={`g${i}-fn`} label={t("firstNameEn")} error={errMsg(`${p}.firstNameEn`)}>
                      <Input id={`g${i}-fn`} dir="ltr" value={g.firstNameEn} onChange={(e) => set({ firstNameEn: e.target.value })} aria-invalid={bad(`${p}.firstNameEn`)} data-testid={`g${i}-firstNameEn`} />
                    </Field>
                    <Field id={`g${i}-ln`} label={t("lastNameEn")} error={errMsg(`${p}.lastNameEn`)}>
                      <Input id={`g${i}-ln`} dir="ltr" value={g.lastNameEn} onChange={(e) => set({ lastNameEn: e.target.value })} aria-invalid={bad(`${p}.lastNameEn`)} data-testid={`g${i}-lastNameEn`} />
                    </Field>
                    <Field id={`g${i}-fnar`} label={t("firstNameAr")} optional>
                      <Input id={`g${i}-fnar`} dir="rtl" value={g.firstNameAr} onChange={(e) => set({ firstNameAr: e.target.value })} />
                    </Field>
                    <Field id={`g${i}-lnar`} label={t("lastNameAr")} optional>
                      <Input id={`g${i}-lnar`} dir="rtl" value={g.lastNameAr} onChange={(e) => set({ lastNameAr: e.target.value })} />
                    </Field>
                    <Field id={`g${i}-email`} label={t("email")} error={errMsg(`${p}.email`)}>
                      <Input id={`g${i}-email`} type="email" dir="ltr" value={g.email} onChange={(e) => set({ email: e.target.value })} aria-invalid={bad(`${p}.email`)} data-testid={`g${i}-email`} />
                    </Field>
                    <Field id={`g${i}-phone`} label={t("phone")} error={errMsg(`${p}.phone`)}>
                      <Input id={`g${i}-phone`} type="tel" dir="ltr" placeholder="+971 50 000 0000" value={g.phone} onChange={(e) => set({ phone: e.target.value })} aria-invalid={bad(`${p}.phone`)} data-testid={`g${i}-phone`} />
                    </Field>
                    <Field id={`g${i}-occ`} label={t("occupation")} optional>
                      <Input id={`g${i}-occ`} value={g.occupation} onChange={(e) => set({ occupation: e.target.value })} />
                    </Field>
                    <Field id={`g${i}-emp`} label={t("employer")} optional>
                      <Input id={`g${i}-emp`} value={g.employer} onChange={(e) => set({ employer: e.target.value })} />
                    </Field>
                  </div>
                  <label className="flex items-center gap-2 text-sm">
                    <Checkbox checked={g.livesWith} onCheckedChange={(v) => set({ livesWith: v === true })} />
                    {t("livesWith")}
                  </label>
                </fieldset>
              );
            })}
            {family.guardians.length < 4 && (
              <Button type="button" variant="outline" size="sm" onClick={() => setFamily({ ...family, guardians: [...family.guardians, { ...emptyGuardian(false), relationship: "FATHER" }] })} data-testid="add-guardian">
                <Plus className="size-4" />
                {t("addGuardian")}
              </Button>
            )}
            <div className="space-y-3 border-t pt-4">
              <div>
                <h3 className="text-sm font-semibold">{t("siblingsTitle")}</h3>
                <p className="text-xs text-muted-foreground">{t("siblingsHint")}</p>
              </div>
              {family.siblings.map((s, i) => {
                const set = (patch: Partial<SiblingV>) => setFamily({ ...family, siblings: family.siblings.map((x, j) => (j === i ? { ...x, ...patch } : x)) });
                return (
                  <div key={i} className="grid gap-2 rounded-lg border p-3 sm:grid-cols-[2fr_1fr_1fr_auto] sm:items-end" data-testid={`sibling-${i}`}>
                    <Field id={`s${i}-name`} label={t("siblingName")} error={errMsg(`siblings.${i}.name`)}>
                      <Input id={`s${i}-name`} value={s.name} onChange={(e) => set({ name: e.target.value })} data-testid={`s${i}-name`} />
                    </Field>
                    <Field id={`s${i}-grade`} label={t("grade")} optional>
                      <select id={`s${i}-grade`} className={selectClass} value={s.gradeLevel ?? ""} onChange={(e) => set({ gradeLevel: e.target.value === "" ? null : Number(e.target.value) })}>
                        <option value="">{t("choose")}</option>
                        {Array.from({ length: 14 }, (_, k) => k - 1).map((g) => (
                          <option key={g} value={g}>
                            {tg("label", gradeLevelValues(g))}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field id={`s${i}-no`} label={t("studentNo")} optional>
                      <Input id={`s${i}-no`} dir="ltr" value={s.studentNo} onChange={(e) => set({ studentNo: e.target.value })} data-testid={`s${i}-no`} />
                    </Field>
                    <Button type="button" variant="ghost" size="sm" onClick={() => setFamily({ ...family, siblings: family.siblings.filter((_, j) => j !== i) })} aria-label={t("remove")}>
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                );
              })}
              {family.siblings.length < 6 && (
                <Button type="button" variant="outline" size="sm" onClick={() => setFamily({ ...family, siblings: [...family.siblings, { name: "", gradeLevel: null, studentNo: "" }] })} data-testid="add-sibling">
                  <Plus className="size-4" />
                  {t("addSibling")}
                </Button>
              )}
              <label className="flex items-start gap-2 text-sm">
                <Checkbox className="mt-0.5" checked={family.staffChild} onCheckedChange={(v) => setFamily({ ...family, staffChild: v === true })} data-testid="f-staffChild" />
                <span>
                  {t("staffChild")}
                  <span className="block text-xs text-muted-foreground">{t("staffChildHint")}</span>
                </span>
              </label>
            </div>
          </div>
        )}

        {step === "health" && (
          <div className="space-y-4">
            <StepHead title={tw("steps.health")} body={tw("healthIntro")} />
            <p className="flex items-start gap-2 rounded-lg bg-info-soft px-3 py-2 text-xs text-info">
              <Info className="mt-0.5 size-3.5 shrink-0" />
              {t("healthPrivacy")}
            </p>
            <Field id="allergies" label={t("allergies")} optional>
              <Textarea id="allergies" rows={2} maxLength={1000} value={health.allergies} onChange={(e) => setHealth({ ...health, allergies: e.target.value })} data-testid="f-allergies" />
            </Field>
            <Field id="conditions" label={t("conditions")} optional>
              <Textarea id="conditions" rows={2} maxLength={1000} value={health.conditions} onChange={(e) => setHealth({ ...health, conditions: e.target.value })} />
            </Field>
            <Field id="medications" label={t("medications")} optional>
              <Textarea id="medications" rows={2} maxLength={1000} value={health.medications} onChange={(e) => setHealth({ ...health, medications: e.target.value })} />
            </Field>
            <Field id="support" label={t("supportQuestion")}>
              <div className="grid grid-cols-2 gap-2" role="radiogroup" id="support">
                {[true, false].map((v) => (
                  <button key={String(v)} type="button" role="radio" aria-checked={health.supportNeeded === v} onClick={() => setHealth({ ...health, supportNeeded: v })} className={cn("h-10 rounded-md border text-sm font-medium transition", health.supportNeeded === v ? "border-brand bg-brand-soft text-brand" : "bg-card hover:bg-muted")} data-testid={`f-support-${v}`}>
                    {t(v ? "yes" : "no")}
                  </button>
                ))}
              </div>
            </Field>
            {health.supportNeeded && (
              <>
                <Field id="supportDetails" label={t("supportDetails")}>
                  <Textarea id="supportDetails" rows={3} maxLength={2000} value={health.supportDetails} onChange={(e) => setHealth({ ...health, supportDetails: e.target.value })} />
                </Field>
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox checked={health.previousAssessment} onCheckedChange={(v) => setHealth({ ...health, previousAssessment: v === true })} />
                  {t("previousAssessment")}
                </label>
              </>
            )}
          </div>
        )}

        {step === "documents" && (
          <div className="space-y-4">
            <StepHead title={tw("steps.documents")} body={tw("documentsIntro")} />
            <DocumentUploads slug={props.slug} applicationId={props.applicationId} docTypes={props.docTypes} docs={props.docs} editable />
          </div>
        )}

        {step === "review" && (
          <div className="space-y-4" data-testid="review">
            <StepHead title={tw("steps.review")} body={tw("reviewIntro")} />
            <ul className="divide-y rounded-xl border">
              {ORDER.filter((s) => s !== "review").map((s) => (
                <li key={s} className="flex items-center gap-3 px-3 py-2.5 text-sm">
                  <span className={cn("grid size-6 shrink-0 place-items-center rounded-full", stepDone(s) ? "bg-success-soft text-success" : "bg-warning-soft text-[oklch(0.5_0.13_65)]")}>{stepDone(s) ? <Check className="size-3.5" /> : <AlertTriangle className="size-3.5" />}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium">{tw(`steps.${s}`)}</span>
                    {s === "documents" && missingRequired.length > 0 && <span className="block text-xs text-muted-foreground">{tw("docsToFollow", { list: missingRequired.map((d) => d.label).join(locale === "ar" ? "، " : ", ") })}</span>}
                  </span>
                  <Button type="button" variant="ghost" size="sm" onClick={() => go(s)}>
                    {tw("edit")}
                  </Button>
                </li>
              ))}
            </ul>
            {missingRequired.length > 0 && <p className="text-xs text-muted-foreground">{tw("docsLaterNote")}</p>}
            <label className="flex items-start gap-2 rounded-lg border bg-muted/30 p-3 text-sm">
              <Checkbox className="mt-0.5" checked={consent} onCheckedChange={(v) => setConsent(v === true)} data-testid="consent" />
              <span>{tw("consent")}</span>
            </label>
          </div>
        )}
      </section>

      <div className="sticky bottom-0 -mx-4 flex flex-wrap items-center justify-between gap-2 border-t bg-background/95 px-4 py-3 backdrop-blur sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:p-0">
        <Button type="button" variant="ghost" size="sm" disabled={pending || step === "student"} onClick={() => go(ORDER[ORDER.indexOf(step) - 1])}>
          <ChevronLeft className="size-4 rtl:rotate-180" />
          {tw("back")}
        </Button>
        <div className="flex flex-wrap gap-2">
          {step !== "documents" && step !== "review" && (
            <Button type="button" variant="outline" size="sm" disabled={pending} onClick={() => save(step, "later")} data-testid="save-later">
              <Save className="size-4" />
              {tw("saveLater")}
            </Button>
          )}
          {step === "documents" ? (
            <Button type="button" size="sm" onClick={() => go("review")} data-testid="docs-continue">
              {tw("continue")}
              <ChevronRight className="size-4 rtl:rotate-180" />
            </Button>
          ) : step === "review" ? (
            <Button type="button" size="sm" disabled={pending || !consent} onClick={submit} data-testid="submit-application">
              {pending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
              {tw("submit")}
            </Button>
          ) : (
            <Button type="button" size="sm" disabled={pending} onClick={() => save(step, "next")} data-testid="save-next">
              {pending ? <Loader2 className="size-4 animate-spin" /> : null}
              {tw("saveContinue")}
              <ChevronRight className="size-4 rtl:rotate-180" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function StepHead({ title, body }: { title: string; body: string }) {
  return (
    <div>
      <h2 className="text-base font-semibold">{title}</h2>
      <p className="mt-0.5 text-sm text-muted-foreground">{body}</p>
    </div>
  );
}

export type { Step };
