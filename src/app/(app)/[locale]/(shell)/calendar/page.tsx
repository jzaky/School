import { getTranslations } from "next-intl/server";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { getCtx } from "@/server/context";
import { formatPrefs } from "@/server/format";
import { fmtNumber, fmtTime, localeTag } from "@/lib/format";
import { personName, pick, userName } from "@/lib/i18n-data";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { PageBody, PageHeader } from "@/components/app/page-header";
import { EmptyState } from "@/components/app/empty-state";
import { CalendarScope } from "@/components/calendar/scope";
import { calendarItems, type CalItem, type CalKind, type CalScope } from "@/server/calendar/items";
import { addDaysKey, dubaiDateKey, dubaiInstant, weekdayOfKey } from "@/server/appointments/slots";

const VIEWS = ["day", "week", "month", "agenda"] as const;
type View = (typeof VIEWS)[number];
const KINDS: CalKind[] = ["appointment", "task", "event", "deadline", "followup"];
const START_H = 7;
const END_H = 18;
const HOUR_PX = 52;

const KIND_STYLE: Record<CalKind, string> = {
  appointment: "border-brand/30 bg-brand-soft text-brand",
  task: "border-warning/40 bg-warning-soft text-[oklch(0.5_0.13_65)]",
  event: "border-success/30 bg-success-soft text-success",
  deadline: "border-danger/30 bg-danger-soft text-danger",
  followup: "border-violet-200 bg-violet-50 text-violet-700",
};

function mondayOf(key: string) {
  const wd = weekdayOfKey(key);
  return addDaysKey(key, -((wd + 6) % 7));
}

export async function generateMetadata() {
  const t = await getTranslations("calendar");
  return { title: t("title") };
}

export default async function CalendarPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await getCtx();
  const t = await getTranslations("calendar");
  const prefs = await formatPrefs(ctx);
  const { db, orgId, locale } = ctx;
  const view: View = VIEWS.includes(sp.view as View) ? (sp.view as View) : ctx.isStaff ? "week" : "agenda";
  const today = dubaiDateKey(new Date());
  const anchor = sp.d && /^\d{4}-\d{2}-\d{2}$/.test(sp.d) ? sp.d : today;
  const weekend = sp.weekend === "1";
  const kinds = (sp.kinds?.split(",").filter((k) => KINDS.includes(k as CalKind)) as CalKind[]) ?? KINDS;
  const activeKinds = kinds.length ? kinds : KINDS;

  let scope: CalScope = { kind: "me" };
  if (sp.staff && ctx.isStaff) scope = { kind: "staff", membershipId: sp.staff };
  else if (sp.dept && ctx.isStaff) scope = { kind: "department", departmentId: sp.dept };
  else if (sp.student) scope = { kind: "student", studentId: sp.student };

  let fromKey: string;
  let days: number;
  if (view === "day") {
    fromKey = anchor;
    days = 1;
  } else if (view === "week") {
    fromKey = mondayOf(anchor);
    days = weekend ? 7 : 5;
  } else if (view === "month") {
    const first = `${anchor.slice(0, 8)}01`;
    fromKey = mondayOf(first);
    days = 42;
  } else {
    fromKey = anchor;
    days = 21;
  }
  const from = dubaiInstant(fromKey, 0);
  const to = dubaiInstant(addDaysKey(fromKey, view === "week" && !weekend ? 7 : days), 0);
  const items = await calendarItems(ctx, from, to, scope, activeKinds);
  const dayKeys = Array.from({ length: days }, (_, i) => addDaysKey(fromKey, i));
  const byDay = (key: string) => items.filter((it) => dubaiDateKey(new Date(it.start)) === key || (it.allDay && dubaiDateKey(new Date(it.start)) <= key && dubaiDateKey(new Date(new Date(it.end).getTime() - 1)) >= key));

  const step = view === "day" ? 1 : view === "week" ? 7 : view === "month" ? 31 : 21;
  const prevKey = view === "month" ? `${addDaysKey(`${anchor.slice(0, 8)}01`, -1).slice(0, 8)}01` : addDaysKey(anchor, -step);
  const nextKey = view === "month" ? `${addDaysKey(`${anchor.slice(0, 8)}28`, 7).slice(0, 8)}01` : addDaysKey(anchor, step);
  const qs = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(Object.entries(sp).filter(([, v]) => v !== undefined) as [string, string][]);
    for (const [k, v] of Object.entries(patch)) (v === null ? next.delete(k) : next.set(k, v));
    return `/calendar?${next.toString()}`;
  };
  const tag = localeTag(prefs);
  const title =
    view === "month"
      ? new Intl.DateTimeFormat(tag, { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${anchor}T12:00:00Z`))
      : view === "day"
        ? new Intl.DateTimeFormat(tag, { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(new Date(`${anchor}T12:00:00Z`))
        : `${new Intl.DateTimeFormat(tag, { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${dayKeys[0]}T12:00:00Z`))} - ${new Intl.DateTimeFormat(tag, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${dayKeys[dayKeys.length - 1]}T12:00:00Z`))}`;
  const dayHead = (key: string, style: "short" | "long" = "short") => ({
    wd: new Intl.DateTimeFormat(tag, { weekday: style, timeZone: "UTC" }).format(new Date(`${key}T12:00:00Z`)),
    d: new Intl.DateTimeFormat(tag, { day: "numeric", timeZone: "UTC" }).format(new Date(`${key}T12:00:00Z`)),
  });

  // Scope options for staff.
  const [staffList, departments, students] = ctx.isStaff
    ? await Promise.all([
        db.membership.findMany({ where: { orgId, status: "ACTIVE", staffProfile: { isNot: null } }, include: { user: true } }),
        db.department.findMany({ where: { orgId }, orderBy: { nameEn: "asc" } }),
        ctx.can("people.view") ? db.student.findMany({ where: { orgId, status: "ACTIVE" }, orderBy: [{ gradeLevel: "asc" }, { firstNameEn: "asc" }] }) : Promise.resolve([]),
      ])
    : [[], [], ctx.isParent ? ctx.membership.guardian?.links.map((l) => l.student) ?? [] : []];

  const Chip = ({ item, compact }: { item: CalItem; compact?: boolean }) => {
    const body = (
      <span className={cn("block truncate rounded-md border px-1.5 py-0.5 text-[11px] font-medium", KIND_STYLE[item.kind])} style={item.color && item.kind === "appointment" ? { borderInlineStartWidth: 3, borderInlineStartColor: item.color } : undefined}>
        {!item.allDay && !compact && <span className="me-1 tabular-nums opacity-80">{fmtTime(prefs, item.start)}</span>}
        {item.title}
      </span>
    );
    return item.href ? (
      <Link href={item.href} title={`${item.title}${item.subtitle ? ` · ${item.subtitle}` : ""}`} data-testid="cal-item">
        {body}
      </Link>
    ) : (
      <span title={item.subtitle ?? item.title} data-testid="cal-item">
        {body}
      </span>
    );
  };

  return (
    <PageBody className="max-w-[1400px]">
      <PageHeader title={t("title")} description={t("subtitle")} />
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="flex items-center gap-2">
          <Link href={qs({ d: prevKey })} className="grid size-9 place-items-center rounded-md border bg-card hover:bg-muted" aria-label={t("previous")}>
            <ChevronLeft className="size-4 rtl:rotate-180" />
          </Link>
          <Link href={qs({ d: today })} className="rounded-md border bg-card px-3 py-1.5 text-sm font-medium hover:bg-muted">
            {t("today")}
          </Link>
          <Link href={qs({ d: nextKey })} className="grid size-9 place-items-center rounded-md border bg-card hover:bg-muted" aria-label={t("next")}>
            <ChevronRight className="size-4 rtl:rotate-180" />
          </Link>
          <h2 className="ms-2 text-base font-semibold" data-testid="cal-title">
            {title}
          </h2>
        </div>
        <div className="flex flex-wrap gap-2 lg:ms-auto">
          <CalendarScope
            staff={staffList.map((m) => ({ value: m.id, label: userName(m.user, locale) })).sort((a, b) => a.label.localeCompare(b.label))}
            departments={departments.map((d) => ({ value: d.id, label: pick(locale, d.nameEn, d.nameAr) }))}
            students={students.map((s) => ({ value: s.id, label: personName(s, locale), hint: `${s.gradeLevel}${s.section ?? ""}` }))}
            isStaff={ctx.isStaff}
          />
          <div className="flex rounded-lg bg-muted p-1">
            {VIEWS.map((v) => (
              <Link key={v} href={qs({ view: v })} data-testid={`view-${v}`} className={cn("rounded-md px-3 py-1 text-sm font-medium", view === v ? "bg-card shadow-xs" : "text-muted-foreground hover:text-foreground")}>
                {t(`view.${v}`)}
              </Link>
            ))}
          </div>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {KINDS.map((k) => {
          const on = activeKinds.includes(k);
          const nextKinds = on ? activeKinds.filter((x) => x !== k) : [...activeKinds, k];
          return (
            <Link key={k} href={qs({ kinds: nextKinds.length === KINDS.length ? null : nextKinds.join(",") || KINDS.join(",") })} className={cn("rounded-full border px-2.5 py-1 text-xs font-medium transition", on ? KIND_STYLE[k] : "bg-card text-muted-foreground line-through")}>
              {t(`kind.${k}`)}
            </Link>
          );
        })}
        {view === "week" && (
          <Link href={qs({ weekend: weekend ? null : "1" })} className="ms-auto text-xs text-muted-foreground hover:text-foreground">
            {weekend ? t("hideWeekend") : t("showWeekend")}
          </Link>
        )}
      </div>

      {(view === "week" || view === "day") && (
        <div className="overflow-x-auto rounded-xl border bg-card shadow-xs">
          <div className="min-w-[720px]" style={{ display: "grid", gridTemplateColumns: `56px repeat(${dayKeys.length}, minmax(0, 1fr))` }}>
            <div className="border-b" />
            {dayKeys.map((k) => {
              const h = dayHead(k, view === "day" ? "long" : "short");
              return (
                <div key={k} className={cn("border-b border-s px-2 py-2 text-center", k === today && "bg-brand-soft/50")}>
                  <div className="text-[11px] font-medium uppercase text-muted-foreground">{h.wd}</div>
                  <div className={cn("mx-auto mt-0.5 grid size-7 place-items-center rounded-full text-sm font-semibold", k === today && "bg-brand text-brand-foreground")}>{h.d}</div>
                </div>
              );
            })}
            <div className="border-b px-1 py-1 text-end text-[10px] text-muted-foreground">{t("allDay")}</div>
            {dayKeys.map((k) => (
              <div key={k} className="min-h-8 space-y-0.5 border-b border-s p-1">
                {byDay(k).filter((i) => i.allDay).map((i) => (
                  <Chip key={i.id} item={i} compact />
                ))}
              </div>
            ))}
            <div className="relative">
              {Array.from({ length: END_H - START_H }, (_, i) => (
                <div key={i} className="relative text-end text-[10px] text-muted-foreground" style={{ height: HOUR_PX }}>
                  <span className="absolute -top-1.5 end-1.5 tabular-nums">{fmtNumber(prefs, START_H + i)}:00</span>
                </div>
              ))}
            </div>
            {dayKeys.map((k) => {
              const timed = byDay(k).filter((i) => !i.allDay);
              const lanes: number[] = [];
              const placed = timed.map((i) => {
                const s = new Date(i.start).getTime();
                let lane = lanes.findIndex((end) => end <= s);
                if (lane < 0) lane = lanes.length;
                lanes[lane] = new Date(i.end).getTime();
                return { i, lane };
              });
              const laneCount = Math.max(1, lanes.length);
              return (
                <div key={k} className={cn("relative border-s", k === today && "bg-brand-soft/20")} style={{ height: (END_H - START_H) * HOUR_PX }}>
                  {Array.from({ length: END_H - START_H }, (_, i) => (
                    <div key={i} className="border-b border-dashed border-border/70" style={{ height: HOUR_PX }} />
                  ))}
                  {placed.map(({ i, lane }) => {
                    const start = new Date(i.start);
                    const end = new Date(i.end);
                    const mins = (start.getTime() - dubaiInstant(k, START_H * 60).getTime()) / 60000;
                    const dur = Math.max(20, (end.getTime() - start.getTime()) / 60000);
                    if (mins < 0 || mins > (END_H - START_H) * 60) return null;
                    return (
                      <div
                        key={i.id}
                        className="absolute px-0.5"
                        style={{ top: (mins / 60) * HOUR_PX, height: (dur / 60) * HOUR_PX - 2, insetInlineStart: `${(lane / laneCount) * 100}%`, width: `${100 / laneCount}%` }}
                      >
                        <Link href={i.href ?? "#"} title={`${fmtTime(prefs, i.start)} ${i.title}${i.subtitle ? ` · ${i.subtitle}` : ""}`} className={cn("flex h-full overflow-hidden rounded-md border text-[11px] leading-tight shadow-xs", dur < 45 ? "items-center gap-1 px-1.5" : "flex-col p-1.5", KIND_STYLE[i.kind])} style={i.color ? { borderInlineStartWidth: 3, borderInlineStartColor: i.color } : undefined} data-testid="cal-item">
                          {dur < 45 ? (
                            <>
                              <span className="shrink-0 tabular-nums opacity-80">{fmtTime(prefs, i.start)}</span>
                              <span className="truncate font-semibold">{i.title}</span>
                            </>
                          ) : (
                            <>
                              <span className="truncate font-semibold">{i.title}</span>
                              <span className="truncate opacity-80">
                                {fmtTime(prefs, i.start)}
                                {i.subtitle ? ` · ${i.subtitle}` : ""}
                              </span>
                            </>
                          )}
                        </Link>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {view === "month" && (
        <div className="overflow-hidden rounded-xl border bg-card shadow-xs">
          <div className="grid grid-cols-7 border-b bg-muted/40">
            {dayKeys.slice(0, 7).map((k) => (
              <div key={k} className="px-2 py-2 text-center text-[11px] font-medium uppercase text-muted-foreground">
                {dayHead(k).wd}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7">
            {dayKeys.map((k) => {
              const inMonth = k.slice(0, 7) === anchor.slice(0, 7);
              const list = byDay(k);
              return (
                <div key={k} className={cn("min-h-28 border-b border-s p-1.5", !inMonth && "bg-muted/30 text-muted-foreground")}>
                  <Link href={qs({ view: "day", d: k })} className={cn("mb-1 inline-grid size-6 place-items-center rounded-full text-xs font-semibold", k === today && "bg-brand text-brand-foreground")}>
                    {dayHead(k).d}
                  </Link>
                  <div className="space-y-0.5">
                    {list.slice(0, 3).map((i) => (
                      <Chip key={i.id} item={i} />
                    ))}
                    {list.length > 3 && (
                      <Link href={qs({ view: "day", d: k })} className="block px-1 text-[11px] text-muted-foreground hover:text-foreground">
                        {t("more", { n: list.length - 3 })}
                      </Link>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {view === "agenda" &&
        (items.length === 0 ? (
          <EmptyState title={t("empty")} />
        ) : (
          <div className="space-y-4">
            {dayKeys
              .map((k) => ({ k, list: byDay(k) }))
              .filter((d) => d.list.length)
              .map(({ k, list }) => (
                <section key={k} className="rounded-xl border bg-card shadow-xs">
                  <div className={cn("flex items-center gap-2 border-b px-4 py-2 text-sm font-semibold", k === today && "bg-brand-soft/50")}>
                    <span>{dayHead(k, "long").wd}</span>
                    <span className="text-muted-foreground">{new Intl.DateTimeFormat(tag, { day: "numeric", month: "long", timeZone: "UTC" }).format(new Date(`${k}T12:00:00Z`))}</span>
                  </div>
                  <ul className="divide-y">
                    {list.map((i) => (
                      <li key={i.id}>
                        <Link href={i.href ?? "#"} className="flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-muted/30" data-testid="cal-item">
                          <span className="w-16 shrink-0 text-xs tabular-nums text-muted-foreground">{i.allDay ? t("allDay") : fmtTime(prefs, i.start)}</span>
                          <span className={cn("size-2 shrink-0 rounded-full", i.kind === "appointment" ? "bg-brand" : i.kind === "task" ? "bg-warning" : i.kind === "deadline" ? "bg-danger" : i.kind === "followup" ? "bg-violet-500" : "bg-success")} />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate font-medium">{i.title}</span>
                            {i.subtitle && <span className="block truncate text-xs text-muted-foreground">{i.subtitle}</span>}
                          </span>
                          <span className="hidden text-xs text-muted-foreground sm:inline">{t(`kind.${i.kind}`)}</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
          </div>
        ))}
    </PageBody>
  );
}
