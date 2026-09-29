import { getTranslations } from "next-intl/server";
import { AlertTriangle, CheckCircle2, CircleHelp, ExternalLink, ShieldCheck, XCircle } from "lucide-react";
import type { FormatPrefs } from "@/lib/format";
import { fmtDate, fmtNumber } from "@/lib/format";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { Pill } from "@/components/app/badges";
import type { CheckItem, CheckResult, Curriculum, ReqCurriculum, ProgramRequirements, EnglishReq, SubjectMin } from "@/server/pathways/types";
import { OVERALL, REQ_CURRICULA } from "@/server/pathways/types";

export type T = Awaited<ReturnType<typeof getTranslations>>;

export const countryLabel = (code: string, locale: string) => {
  try {
    return new Intl.DisplayNames([locale === "ar" ? "ar" : "en"], { type: "region" }).of(code) ?? code;
  } catch {
    return code;
  }
};

export function subjectLabel(t: T, code: string) {
  return t.has(`subject.${code}`) ? t(`subject.${code}`) : code;
}
export function testLabel(t: T, code: string) {
  return t.has(`test.${code}`) ? t(`test.${code}`) : code;
}

const withMins = (t: T, list: SubjectMin[] | undefined) => (list ?? []).map((s) => (s.min ? t("req.subjectMin", { subject: subjectLabel(t, s.code), min: s.min }) : subjectLabel(t, s.code))).join(t("req.sep"));

/** Human-readable requirement lines for one curriculum. Empty when nothing is listed. */
export function requirementLines(t: T, cur: Curriculum, req: ProgramRequirements, fmt: (n: number) => string): string[] {
  const out: string[] = [];
  if (cur === "BRITISH" && req.BRITISH) {
    const r = req.BRITISH;
    if (r.grades) out.push(t("req.aLevels", { grades: r.grades }));
    if (r.subjects?.length) out.push(t("req.including", { subjects: withMins(t, r.subjects) }));
  } else if (cur === "IB" && req.IB) {
    const r = req.IB;
    if (r.points) out.push(t("req.ibPoints", { points: fmt(r.points) }));
    if (r.hl?.length) out.push(t("req.hl", { subjects: withMins(t, r.hl) }));
    if (r.sl?.length) out.push(t("req.sl", { subjects: withMins(t, r.sl) }));
  } else if (cur === "AMERICAN" && req.AMERICAN) {
    const r = req.AMERICAN;
    if (r.gpa) out.push(t("req.gpa", { gpa: fmt(r.gpa) }));
    if (r.testPolicy) out.push(t(`req.policy.${r.testPolicy}`));
    if (r.sat) out.push(t("req.sat", { score: fmt(r.sat) }));
    if (r.act) out.push(t("req.act", { score: fmt(r.act) }));
    if (r.ap?.length) out.push(t("req.ap", { subjects: withMins(t, r.ap) }));
  } else if (cur === "UAE_MOE" && req.UAE_MOE) {
    const r = req.UAE_MOE;
    if (r.streams?.length) out.push(t("req.streams", { streams: r.streams.map((s) => t(`stream.${s}`)).join(t("req.or")) }));
    if (r.average) out.push(t("req.average", { pct: fmt(r.average) }));
    if (r.emsat?.length) out.push(t("req.emsat", { tests: r.emsat.map((e) => (e.min ? `${testLabel(t, e.kind)} ${fmt(e.min)}` : testLabel(t, e.kind))).join(t("req.sep")) }));
  } else if (cur === "JORDAN_TAWJIHI" && req.JORDAN_TAWJIHI) {
    const r = req.JORDAN_TAWJIHI;
    if (r.streams?.length) out.push(t("req.streams", { streams: r.streams.map((s) => t(`stream.${s}`)).join(t("req.or")) }));
    if (r.average) out.push(t("req.tawjihi", { pct: fmt(r.average) }));
    for (const [s, v] of Object.entries(r.byStream ?? {})) out.push(t("req.tawjihiStream", { stream: t(`stream.${s}`), pct: fmt(v) }));
  }
  return out;
}

export function curriculumNote(cur: Curriculum, req: ProgramRequirements, locale: string): string | null {
  if (!(REQ_CURRICULA as readonly string[]).includes(cur)) return null;
  const r = req[cur as ReqCurriculum];
  if (!r) return null;
  return (locale === "ar" ? r.notesAr : r.notesEn) ?? null;
}

export function englishLines(t: T, en: EnglishReq | null, fmt: (n: number) => string, locale: string): string[] {
  if (!en) return [];
  const out: string[] = [];
  if (en.ielts) out.push(en.ieltsMinBand ? t("req.ieltsBand", { score: fmt(en.ielts), band: fmt(en.ieltsMinBand) }) : t("req.ielts", { score: fmt(en.ielts) }));
  if (en.toefl) out.push(t("req.toefl", { score: fmt(en.toefl) }));
  if (en.emsatEnglish) out.push(t("req.emsatEnglish", { score: fmt(en.emsatEnglish) }));
  const note = locale === "ar" ? en.notesAr : en.notesEn;
  if (note) out.push(note);
  return out;
}

/** "Not yet checked" or "Checked on ..." with the source link. */
export async function SourceNote({ sourceUrl, lastVerifiedAt, indicative, prefs, checkedBy, compact }: { sourceUrl: string | null; lastVerifiedAt: Date | null; indicative: boolean; prefs: FormatPrefs; checkedBy?: string | null; compact?: boolean }) {
  const t = await getTranslations("pathways");
  const checked = !!lastVerifiedAt && !indicative;
  return (
    <div className={cn("flex flex-wrap items-center gap-x-3 gap-y-1 text-xs", compact ? "" : "rounded-lg border px-3 py-2", checked ? "text-muted-foreground" : "border-warning/40 bg-warning-soft/40")} data-testid="source-note">
      {checked ? (
        <span className="inline-flex items-center gap-1 text-success">
          <ShieldCheck className="size-3.5" />
          {checkedBy ? t("checkedOnBy", { date: fmtDate(prefs, lastVerifiedAt), name: checkedBy }) : t("checkedOn", { date: fmtDate(prefs, lastVerifiedAt) })}
        </span>
      ) : (
        <span className="inline-flex items-center gap-1 font-medium text-[oklch(0.5_0.14_65)]">
          <AlertTriangle className="size-3.5" />
          {t("notChecked")}
        </span>
      )}
      {sourceUrl && (
        <a href={sourceUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-brand hover:underline" data-testid="source-link">
          {t("officialPage")}
          <ExternalLink className="size-3" />
        </a>
      )}
    </div>
  );
}

export function StatusIcon({ status, optional }: { status: CheckItem["status"]; optional?: boolean }) {
  if (status === "met") return <CheckCircle2 className="size-4 shrink-0 text-success" />;
  if (status === "not_met") return optional ? <CircleHelp className="size-4 shrink-0 text-muted-foreground" /> : <XCircle className="size-4 shrink-0 text-danger" />;
  return <CircleHelp className="size-4 shrink-0 text-muted-foreground" />;
}

function itemLabel(t: T, cur: Curriculum, i: CheckItem) {
  switch (i.kind) {
    case "overall":
      return t(`check.overall.${cur}`);
    case "stream":
      return t("check.stream");
    case "subject":
      return subjectLabel(t, i.code ?? "");
    case "recommended":
      return t("check.recommended", { subject: subjectLabel(t, i.code ?? "") });
    case "test":
      return i.alternatives?.length && i.code !== undefined && ["SAT", "ACT"].includes(i.code) ? t("check.satAct") : testLabel(t, i.code ?? "");
    case "admissionsTest":
      return t("check.admissionsTest", { test: testLabel(t, i.code ?? "") });
    case "english":
      return t("check.english");
  }
}

function show(v: string | number | null | undefined, fmt: (n: number) => string) {
  if (v === null || v === undefined) return null;
  return typeof v === "number" ? fmt(v) : v;
}

function itemRequired(t: T, i: CheckItem, fmt: (n: number) => string) {
  if (i.kind === "stream") return String(i.required ?? "").split(",").filter(Boolean).map((s) => t(`stream.${s}`)).join(t("req.or"));
  if (i.kind === "subject") return i.required ? t("check.gradeMin", { min: String(i.required) }) : t("check.mustTake");
  if (i.kind === "recommended") return t("check.recommendedShort");
  if (i.kind === "admissionsTest") return t("check.mustSit");
  if (i.kind === "english") return `${testLabel(t, i.code ?? "")} ${show(i.required, fmt)}`;
  if (i.kind === "test") return i.required !== null && i.required !== undefined ? `${testLabel(t, i.code ?? "")} ${show(i.required, fmt)}` : i.optional ? t("check.optional") : t("check.anyScore");
  if (i.kind === "overall" && typeof i.required === "number") return show(i.required, fmt);
  return show(i.required, fmt);
}

function itemHave(t: T, i: CheckItem, fmt: (n: number) => string) {
  if (i.kind === "stream") return i.have ? t(`stream.${i.have}`) : t("check.none");
  if (i.kind === "subject" || i.kind === "recommended") {
    if (i.have) return String(i.have);
    return i.taking ? t("check.taking") : t("check.notTaking");
  }
  if (i.kind === "english" || i.kind === "test" || i.kind === "admissionsTest") return i.have !== null && i.have !== undefined ? `${testLabel(t, i.code ?? "")} ${show(i.have, fmt)}` : t("check.none");
  return show(i.have, fmt) ?? t("check.none");
}

/** One sentence that explains a gap: which class to take or which score to raise. */
export function gapText(t: T, i: CheckItem, fmt: (n: number) => string): string | null {
  if (i.status !== "not_met") return null;
  if (i.kind === "subject" || i.kind === "recommended") {
    if (i.have) return t("gap.grade", { subject: subjectLabel(t, i.code ?? ""), required: String(i.required), have: String(i.have) });
    return i.offered === false ? t("gap.notOffered", { subject: subjectLabel(t, i.code ?? "") }) : t("gap.takeClass", { subject: subjectLabel(t, i.code ?? "") });
  }
  if ((i.kind === "english" || i.kind === "test") && typeof i.required === "number" && typeof i.have === "number") return t("gap.score", { test: testLabel(t, i.code ?? ""), required: fmt(i.required), have: fmt(i.have) });
  if (i.kind === "test") return t("gap.sitTest", { test: testLabel(t, i.code ?? "") });
  if (i.kind === "admissionsTest") return t("gap.register", { test: testLabel(t, i.code ?? "") });
  if (i.kind === "overall") return t("gap.overall", { required: String(show(i.required, fmt)), have: String(show(i.have, fmt)) });
  if (i.kind === "stream") return t("gap.stream");
  return null;
}

/** The checker result as a table: requirement, what is needed, what the student has, status. */
export async function CheckTable({ check, prefs }: { check: CheckResult; prefs: FormatPrefs }) {
  const t = await getTranslations("pathways");
  const fmt = (n: number) => fmtNumber(prefs, n);
  if (!check.items.length) return <p className="text-sm text-muted-foreground">{t("check.nothingListed")}</p>;
  return (
    <ul className="divide-y rounded-lg border" data-testid="check-table">
      {check.items.map((i) => {
        const gap = gapText(t, i, fmt);
        return (
          <li key={i.id} className="flex items-start gap-3 px-3 py-2.5 text-sm" data-testid={`check-${i.id}`} data-status={i.status}>
            <StatusIcon status={i.status} optional={i.optional} />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="font-medium">{itemLabel(t, check.curriculum, i)}</span>
                {i.provisional && <Pill tone="info">{t("check.predicted")}</Pill>}
                {i.unconfirmed && <Pill tone="warning">{t("check.unconfirmed")}</Pill>}
              </div>
              <div className="mt-0.5 grid gap-x-4 text-xs text-muted-foreground sm:grid-cols-2">
                <span>
                  {t("check.needed")}: <span className="text-foreground">{itemRequired(t, i, fmt)}</span>
                </span>
                <span>
                  {t("check.yours")}: <span className="text-foreground">{itemHave(t, i, fmt)}</span>
                </span>
              </div>
              {gap && (
                <p className={cn("mt-1 text-xs", i.optional ? "text-muted-foreground" : "text-danger")}>
                  {gap}
                  {(i.kind === "subject" || i.kind === "recommended") && !i.have && i.offered !== false && (
                    <>
                      {" "}
                      <Link href="/subjects" className="font-medium text-brand hover:underline">
                        {t("gap.seeSubjects")}
                      </Link>
                    </>
                  )}
                </p>
              )}
            </div>
            <span className="shrink-0 text-xs font-medium">{t(`status.${i.optional && i.status !== "met" ? "optional" : i.status}`)}</span>
          </li>
        );
      })}
    </ul>
  );
}

/** Compact met / not met / unknown counters. */
export async function CheckSummary({ check }: { check: CheckResult }) {
  const t = await getTranslations("pathways");
  const { met, notMet, unknown } = check.summary;
  if (!check.listed)
    return (
      <span data-testid="check-summary">
        <Pill>{t("summary.notListed")}</Pill>
      </span>
    );
  return (
    <span className="inline-flex flex-wrap gap-1.5" data-testid="check-summary">
      <Pill tone="success">{t("summary.met", { n: met })}</Pill>
      {notMet > 0 && <Pill tone="danger">{t("summary.notMet", { n: notMet })}</Pill>}
      {unknown > 0 && <Pill tone="neutral">{t("summary.unknown", { n: unknown })}</Pill>}
    </span>
  );
}

export const OVERALL_CODE = OVERALL;
