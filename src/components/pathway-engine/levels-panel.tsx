// Subject levels across a student's targets ("AP planner") and the worldwide summary, for the
// University planning overview. Server components: every number comes from the engine.
import { getTranslations } from "next-intl/server";
import { ArrowRight, CheckCircle2, CircleDashed, ExternalLink, Globe2, Layers, Quote, School } from "lucide-react";
import { Link } from "@/i18n/navigation";
import type { Ctx } from "@/server/context";
import { pick } from "@/lib/i18n-data";
import { fmtNumber } from "@/lib/format";
import { formatPrefs } from "@/server/format";
import { cn } from "@/lib/utils";
import { Panel, PanelHeader } from "@/components/app/panel";
import { Pill } from "@/components/app/badges";
import { countryLabel } from "@/components/pathways/pathway-ui";
import { subjectLevelsFor, worldwideFor } from "@/server/pathway-engine/levels-service";
import { subjectNames, type EngineFocus } from "@/server/pathway-engine/page-data";
import { HIGH_CLASSES } from "@/server/pathway-engine/level-guide";
import type { LevelEntry, LevelRow } from "@/server/pathway-engine/levels";
import { STATUS_ORDER, STATUS_TONE, subjectList, type Tr } from "./labels";
import { LevelChip } from "./level-chip";
import { StatusChip } from "./ui";

type Kind = "high" | "regular" | "advice" | "none";
const DOT: Record<Kind, string> = {
  high: "bg-violet-600 ring-violet-600",
  regular: "bg-success ring-success",
  advice: "bg-transparent ring-muted-foreground/50",
  none: "bg-muted ring-border",
};
const kindOf = (e: LevelEntry | undefined): Kind => (!e ? "none" : e.advisory ? "advice" : HIGH_CLASSES.has(e.cls) ? "high" : "regular");
const curKey = (c: string) => (c === "AMERICAN" || c === "BRITISH" || c === "IB" ? c : "OTHER");

export async function SubjectLevelsPanel({ ctx, focus }: { ctx: Ctx; focus: EngineFocus }) {
  const t = await getTranslations("engine.levels");
  const te = (await getTranslations("engine")) as unknown as Tr;
  const s = focus.student!;
  const [data, names, prefs] = await Promise.all([subjectLevelsFor(focus.actor, s.id), subjectNames(ctx), formatPrefs(ctx)]);
  const { plan, programs } = data;
  const L = (en: string, ar: string | null | undefined) => pick(ctx.locale, en, ar ?? "");
  const self = ctx.isStudent;
  const cur = curKey(plan.curriculum);
  const school = L(ctx.org.shortNameEn ?? ctx.org.nameEn, ctx.org.shortNameAr ?? ctx.org.nameAr);
  const byId = new Map(programs.map((p) => [p.id, p]));
  const total = plan.targetIds.length;
  const uni = (id: string) => {
    const p = byId.get(id);
    return p ? L(p.university.nameEn, p.university.nameAr) : "";
  };
  const familyName = (row: LevelRow) => {
    if (row.key === "sciences") return t("family.sciences");
    if (row.key === "english") return t("family.english");
    if (names[row.key]) return L(names[row.key].en, names[row.key].ar);
    return subjectList(row.key.split("+"), names, ctx.locale, te);
  };
  const courseName = (code: string) => {
    const c = data.offers[code] ?? data.courseNames[code];
    return c ? L(c.nameEn, c.nameAr) : code;
  };
  const listNames = (ids: string[]) => ids.map(uni).join(te("line.and"));
  const v = self ? "self" : "other";
  // The course picker: students and parents (registration.submit), registration staff and advisers.
  const canSeeChoices = ctx.isStaff ? ctx.can("registration.manage") || ctx.can("pathways.manage") || ctx.can("planner.approve") : ctx.can("registration.submit");

  const headline = (row: LevelRow): string => {
    const subject = familyName(row);
    if (row.high.length) {
      const n = row.high.length;
      if (row.course) return t(`take.course.${v}`, { course: courseName(row.course), n, total });
      return t(`take.generic.${cur}.${v}`, { subject, n, total });
    }
    if (row.regular.length) {
      if (row.senior) return t(`enough.senior.${v}`, { subject, grade: Math.max(...row.entries.filter((e) => e.cls === "SENIOR").map((e) => e.fromGrade ?? 12)) });
      if (row.key === "sciences") return t(`enough.sciences.${cur === "AMERICAN" ? "regular" : "standard"}.${v}`);
      return t(`enough.${cur === "AMERICAN" ? "regular" : "standard"}.${v}`, { subject });
    }
    return t(`advice.${v}`, { subject, n: row.advice.length, total });
  };

  if (total === 0) {
    return (
      <div id="levels" className="scroll-mt-24">
        <Panel>
          <PanelHeader title={t("title")} icon={<Layers className="size-4" />} description={t(`desc.${cur}`)} />
          <p className="text-sm text-muted-foreground" data-testid="levels-empty">
            {t("empty")}
          </p>
        </Panel>
      </div>
    );
  }

  return (
    <div id="levels" className="scroll-mt-24" data-testid="subject-levels">
    <Panel>
      <PanelHeader
        title={t("title")}
        icon={<Layers className="size-4" />}
        description={t(`desc.${cur}`)}
        action={<Pill tone="brand">{t(`source.${data.source}`, { n: total })}</Pill>}
      />
      {/* Targets, numbered: the dots in each row follow this order. */}
      <ol className="mb-4 flex flex-wrap gap-x-3 gap-y-1.5 text-xs text-muted-foreground" data-testid="levels-targets">
        {plan.targetIds.map((id, i) => (
          <li key={id} className="inline-flex items-center gap-1">
            <span className="grid size-4 place-items-center rounded-full bg-muted text-[10px] font-semibold tabular-nums text-foreground">{fmtNumber(prefs, i + 1)}</span>
            {uni(id)}
          </li>
        ))}
      </ol>
      <div className="mb-4 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {(["high", "regular", "advice", "none"] as Kind[]).map((k) => (
          <span key={k} className="inline-flex items-center gap-1.5">
            <span className={cn("size-2.5 rounded-full ring-1 ring-inset", DOT[k])} />
            {t(`legend.${k}.${k === "high" ? cur : "all"}`)}
          </span>
        ))}
      </div>
      {plan.rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("noLines")}</p>
      ) : (
        <ul className="space-y-3" data-testid="levels-rows">
          {plan.rows.map((row) => {
            const entries = new Map(row.entries.map((e) => [e.programId, e]));
            const counted = row.entries.filter((e) => !e.advisory);
            const covered = counted.length > 0 && counted.every((e) => e.status !== "not_met");
            const onPlan = [...new Set(counted.flatMap((e) => e.satisfiedBy.map((c) => L(c.nameEn, c.nameAr))))];
            const offer = row.course ? data.offers[row.course] : null;
            const advanced = !row.course && row.high.length ? (data.advancedBySubject[row.keys[0]] ?? []) : [];
            return (
              <li key={row.key} className={cn("rounded-xl border p-4", row.high.length ? "border-violet-200 bg-violet-50/40 dark:border-violet-900 dark:bg-violet-950/20" : "bg-card")} data-testid="levels-row" data-family={row.key}>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0 space-y-1">
                    <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{familyName(row)}</div>
                    <p className="text-base font-semibold leading-snug" data-testid="levels-headline">
                      {headline(row)}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {[
                        row.high.length && row.regular.length ? t("alsoRegular", { n: row.regular.length, names: listNames(row.regular) }) : null,
                        row.bcOnly.length && row.bcOnly.length < row.high.length ? t("bcOnly", { n: row.bcOnly.length }) : null,
                        !row.high.length && row.regular.length ? t("askedBy", { n: row.regular.length, total, names: listNames(row.regular) }) : null,
                        row.advice.length && (row.high.length || row.regular.length) ? t("alsoAdvice", { names: listNames(row.advice) }) : null,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-1" aria-hidden data-testid="levels-dots">
                    {plan.targetIds.map((id, i) => {
                      const k = kindOf(entries.get(id));
                      return <span key={id} title={`${i + 1}. ${uni(id)}`} className={cn("size-3.5 rounded-full ring-2 ring-inset", DOT[k])} />;
                    })}
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {row.entries
                    .slice()
                    .sort((a, b) => plan.targetIds.indexOf(a.programId) - plan.targetIds.indexOf(b.programId))
                    .map((e) => (
                      <span key={e.programId} className="inline-flex items-center gap-1 rounded-full border bg-background py-0.5 pe-0.5 ps-2.5 text-xs">
                        <span className="max-w-[12rem] truncate sm:max-w-[18rem]">{uni(e.programId)}</span>
                        <LevelChip guide={{ cls: e.cls, curriculum: plan.curriculum, basis: "quote", apCourses: e.apCourses, onlyCodes: e.onlyCodes, fromGrade: e.fromGrade, effectiveLevel: null, storedLevel: null }} advisory={e.advisory} />
                      </span>
                    ))}
                </div>
                <div className="mt-3 flex flex-col gap-1.5 text-xs sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-4">
                  {counted.length > 0 && (
                    <span className={cn("inline-flex items-center gap-1.5", covered ? "text-success" : "text-muted-foreground")} data-testid="levels-plan">
                      {covered ? <CheckCircle2 className="size-3.5" /> : <CircleDashed className="size-3.5" />}
                      {covered ? t(`onPlan.${v}`, { courses: onPlan.join(te("line.and")) || "-" }) : t(`notOnPlan.${v}`)}
                    </span>
                  )}
                  {row.course && (
                    <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                      <School className="size-3.5" />
                      {offer ? t("offered", { school, course: courseName(row.course), grade: offer.gradeLevels[0] ?? "" }) : t("notOffered", { school, course: courseName(row.course) })}
                    </span>
                  )}
                  {advanced.length > 0 && (
                    <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                      <School className="size-3.5" />
                      {t("offeredList", { school, courses: advanced.slice(0, 3).map((c) => L(c.nameEn, c.nameAr)).join(te("line.and")) })}
                    </span>
                  )}
                </div>
                <details className="group mt-2">
                  <summary className="cursor-pointer list-none text-xs font-medium text-brand hover:underline" data-testid="levels-quotes">
                    {t("showQuotes")}
                  </summary>
                  <ul className="mt-2 space-y-2 border-s-2 ps-3">
                    {row.entries.map((e) => (
                      <li key={e.programId} className="text-xs">
                        <div className="flex flex-wrap items-center gap-1.5 font-medium">
                          {uni(e.programId)}
                          <span className="font-normal text-muted-foreground">{L(byId.get(e.programId)?.nameEn ?? "", byId.get(e.programId)?.nameAr)}</span>
                          {e.via === "exam_rule" && <Pill>{t("viaExamRule")}</Pill>}
                        </div>
                        {e.quote ? (
                          <p className="mt-0.5 flex items-start gap-1 text-muted-foreground">
                            <Quote className="mt-0.5 size-3 shrink-0" />
                            <q className="italic" dir="ltr">
                              {e.quote}
                            </q>
                            {e.sourceUrl && (
                              <a href={e.sourceUrl} target="_blank" rel="noopener noreferrer" className="ms-1 inline-flex shrink-0 items-center gap-0.5 not-italic text-brand hover:underline">
                                {te("program.lineSource")}
                                <ExternalLink className="size-3" />
                              </a>
                            )}
                          </p>
                        ) : (
                          <p className="mt-0.5 text-muted-foreground">{t("noQuote")}</p>
                        )}
                      </li>
                    ))}
                  </ul>
                </details>
              </li>
            );
          })}
        </ul>
      )}
      <div className="mt-4 flex flex-col gap-2 border-t pt-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs text-muted-foreground">{t("footer")}</p>
        {canSeeChoices && (
          <Link href={ctx.isStudent ? "/subjects" : `/subjects?student=${s.id}`} className="inline-flex shrink-0 items-center gap-1 text-sm font-medium text-brand hover:underline" data-testid="levels-choices">
            {t(`choices.${v}`)}
            <ArrowRight className="size-3.5 rtl:rotate-180" />
          </Link>
        )}
      </div>
    </Panel>
    </div>
  );
}

export async function WorldwidePanel({ ctx, focus }: { ctx: Ctx; focus: EngineFocus }) {
  const t = await getTranslations("engine.world");
  const prefs = await formatPrefs(ctx);
  const fmt = (n: number) => fmtNumber(prefs, n);
  const s = focus.student!;
  const w = await worldwideFor(focus.actor, s.id);
  const school = pick(ctx.locale, ctx.org.shortNameEn ?? ctx.org.nameEn, ctx.org.shortNameAr ?? ctx.org.nameAr ?? "");
  const v = ctx.isStudent ? "self" : "other";
  if (w.programs === 0) return null;
  return (
    <div data-testid="worldwide">
    <Panel>
      <PanelHeader title={t("title")} icon={<Globe2 className="size-4" />} description={w.withPlan ? t("withPlan") : t("recordOnly")} />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground" data-testid="worldwide-checked">
            {t(`checked.${v}`, { school, programs: fmt(w.programs), universities: fmt(w.universities), countries: fmt(w.countries), name: s.name })}
          </p>
          <div className="flex items-end gap-3">
            <span className="text-4xl font-semibold tabular-nums text-success" data-testid="worldwide-open">
              {fmt(w.open)}
            </span>
            <span className="pb-1 text-sm leading-snug">
              <span className="block font-medium">{t("openLabel")}</span>
              <span className="block text-muted-foreground">{t("openWhere", { universities: fmt(w.openUniversities), countries: fmt(w.openCountries) })}</span>
            </span>
          </div>
          <div className="flex h-2.5 overflow-hidden rounded-full bg-muted" aria-hidden>
            {STATUS_ORDER.map((st) =>
              w.counts[st] ? <span key={st} className={cn("h-full", BAR[STATUS_TONE[st]])} style={{ width: `${(w.counts[st] / w.programs) * 100}%` }} /> : null,
            )}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {STATUS_ORDER.filter((st) => w.counts[st] > 0).map((st) => (
              <span key={st} className="inline-flex items-center gap-1 text-xs">
                <span className="font-semibold tabular-nums">{fmt(w.counts[st])}</span>
                <StatusChip status={st} />
              </span>
            ))}
          </div>
        </div>
        <div>
          <div className="mb-2 text-xs font-medium text-muted-foreground">{t("byCountry")}</div>
          <ul className="grid grid-cols-2 gap-1.5 sm:grid-cols-3" data-testid="worldwide-countries">
            {w.byCountry.slice(0, 9).map((c) => (
              <li key={c.country} className="rounded-lg border px-2.5 py-1.5">
                <div className="truncate text-xs font-medium">{countryLabel(c.country, ctx.locale)}</div>
                <div className="text-xs text-muted-foreground">{t("countryLine", { open: fmt(c.open), programs: fmt(c.programs) })}</div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </Panel>
    </div>
  );
}

const BAR: Record<string, string> = {
  success: "bg-success",
  brand: "bg-brand",
  info: "bg-info",
  danger: "bg-danger",
  warning: "bg-warning",
  neutral: "bg-muted-foreground/40",
};
