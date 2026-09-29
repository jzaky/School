import { getTranslations } from "next-intl/server";
import { moduleEnabled } from "@/lib/modules";
import { ArrowRight, CalendarClock, CheckSquare, Inbox, MapPin, Megaphone, Video } from "lucide-react";
import type { Ctx } from "@/server/context";
import type { FormatPrefs } from "@/lib/format";
import { fmtDate, fmtDateTime, fmtHijri, fmtRelative, fmtTime, isSameDubaiDay } from "@/lib/format";
import { personName, pick, userName } from "@/lib/i18n-data";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { Panel, PanelHeader } from "@/components/app/panel";
import { RequestStatusBadge, PriorityBadge } from "@/components/app/badges";
import { Icon } from "@/components/icon";
import { TaskCheck } from "./task-check";
import { requestWhere, isRestrictedForViewer } from "@/server/access/request-access";
import { appointmentWhere } from "@/server/appointments/queries";

export async function Greeting({ ctx, prefs, subtitle }: { ctx: Ctx; prefs: FormatPrefs; subtitle?: React.ReactNode }) {
  const t = await getTranslations("home");
  const hour = (new Date().getUTCHours() + 4) % 24;
  const key = hour < 12 ? "morning" : hour < 17 ? "afternoon" : "evening";
  const first = ctx.membership.student
    ? pick(ctx.locale, ctx.membership.student.firstNameEn, ctx.membership.student.firstNameAr)
    : userName(ctx.user, ctx.locale).split(" ")[0];
  const now = new Date();
  return (
    <div className="flex flex-col gap-1">
      <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
        {fmtDate(prefs, now, "long")}
        {prefs.hijri && <span className="ms-2 normal-case">· {fmtHijri(prefs, now)}</span>}
      </div>
      <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl" data-testid="greeting">
        {t(`greeting.${key}`, { name: first })}
      </h1>
      {subtitle && <p className="text-sm text-muted-foreground">{subtitle}</p>}
    </div>
  );
}

export async function MeetingsPanel({ ctx, prefs, limit = 5, title, onlyToday = false }: { ctx: Ctx; prefs: FormatPrefs; limit?: number; title?: string; onlyToday?: boolean }) {
  if (!moduleEnabled(ctx.org, "meetings")) return null;
  const t = await getTranslations("home");
  const now = new Date();
  const endOfToday = new Date(now.getTime() + 24 * 3600_000);
  const appts = await ctx.db.appointment.findMany({
    where: {
      AND: [
        await appointmentWhere(ctx),
        { status: { in: ["CONFIRMED", "SCHEDULED"] }, endsAt: { gt: now }, ...(onlyToday ? { startsAt: { lt: endOfToday } } : {}) },
      ],
    },
    include: { type: true },
    orderBy: { startsAt: "asc" },
    take: limit,
  });
  const people = await ctx.db.membership.findMany({ where: { id: { in: appts.map((a) => a.hostId) } }, include: { user: true } });
  const students = await ctx.db.student.findMany({ where: { id: { in: appts.map((a) => a.studentId).filter(Boolean) as string[] } } });
  return (
    <Panel>
      <PanelHeader
        title={title ?? t("upcomingMeetings")}
        icon={<CalendarClock className="size-4" />}
        action={
          <Link href={ctx.isStaff ? "/calendar" : "/meetings"} className="text-xs font-medium text-brand hover:underline">
            {t("seeAll")}
          </Link>
        }
      />
      {appts.length === 0 ? (
        <p className="py-4 text-center text-sm text-muted-foreground">{onlyToday ? t("noMeetingsToday") : t("noMeetings")}</p>
      ) : (
        <ul className="space-y-2">
          {appts.map((a) => {
            const host = people.find((p) => p.id === a.hostId);
            const student = students.find((s) => s.id === a.studentId);
            const withWhom = a.hostId === ctx.membershipId ? (student ? personName(student, ctx.locale) : "") : host ? userName(host.user, ctx.locale) : "";
            const today = isSameDubaiDay(a.startsAt, now);
            return (
              <li key={a.id}>
                <Link href={`/meetings/${a.id}`} className="flex items-center gap-3 rounded-lg border p-3 transition hover:border-brand/30 hover:bg-muted/30" data-testid="meeting-item">
                  <div className={cn("flex w-14 shrink-0 flex-col items-center rounded-md py-1.5 text-center", today ? "bg-brand text-brand-foreground" : "bg-muted")}>
                    <span className="text-[10px] font-medium uppercase opacity-80">{today ? t("today") : fmtDate(prefs, a.startsAt, "short")}</span>
                    <span className="text-sm font-semibold tabular-nums">{fmtTime(prefs, a.startsAt)}</span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{pick(ctx.locale, a.type.nameEn, a.type.nameAr)}</div>
                    <div className="truncate text-xs text-muted-foreground">{withWhom}</div>
                  </div>
                  <span className="hidden shrink-0 items-center gap-1 text-xs text-muted-foreground sm:flex">
                    {a.meetingUrl ? <Video className="size-3.5" /> : <MapPin className="size-3.5" />}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}

export async function TasksPanel({ ctx, prefs, limit = 6, title }: { ctx: Ctx; prefs: FormatPrefs; limit?: number; title?: string }) {
  const t = await getTranslations("home");
  const tasks = await ctx.db.task.findMany({
    where: { orgId: ctx.orgId, assigneeId: ctx.membershipId, status: { in: ["TODO", "IN_PROGRESS"] } },
    orderBy: [{ dueAt: { sort: "asc", nulls: "last" } }],
    take: limit,
  });
  const now = Date.now();
  return (
    <Panel>
      <PanelHeader
        title={title ?? t("myTasks")}
        icon={<CheckSquare className="size-4" />}
        action={
          <Link href="/tasks" className="text-xs font-medium text-brand hover:underline">
            {t("seeAll")}
          </Link>
        }
      />
      {tasks.length === 0 ? (
        <p className="py-4 text-center text-sm text-muted-foreground">{t("noTasks")}</p>
      ) : (
        <ul className="divide-y">
          {tasks.map((task) => {
            const overdue = task.dueAt && task.dueAt.getTime() < now;
            const title = pick(ctx.locale, task.titleEn, task.titleAr);
            return (
              <li key={task.id} className="flex items-center gap-3 py-2.5">
                <TaskCheck id={task.id} done={false} label={title} />
                <div className="min-w-0 flex-1">
                  {task.href ? (
                    <Link href={task.href} className="block truncate text-sm hover:text-brand">
                      {title}
                    </Link>
                  ) : (
                    <span className="block truncate text-sm">{title}</span>
                  )}
                  {task.dueAt && <span className={cn("text-xs", overdue ? "font-medium text-danger" : "text-muted-foreground")}>{overdue ? t("overdueSince", { when: fmtRelative(prefs, task.dueAt) }) : t("dueWhen", { when: fmtRelative(prefs, task.dueAt) })}</span>}
                </div>
                {task.priority === "HIGH" || task.priority === "URGENT" ? <PriorityBadge priority={task.priority} /> : null}
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}

export async function RequestsPanel({ ctx, prefs, limit = 4, title, mineOnly = false }: { ctx: Ctx; prefs: FormatPrefs; limit?: number; title?: string; mineOnly?: boolean }) {
  const t = await getTranslations("home");
  const rows = await ctx.db.request.findMany({
    where: { AND: [requestWhere(ctx), mineOnly ? { requesterId: ctx.membershipId } : {}] },
    include: { service: true, student: true },
    orderBy: [{ updatedAt: "desc" }],
    take: limit,
  });
  return (
    <Panel>
      <PanelHeader
        title={title ?? t("yourRequests")}
        icon={<Inbox className="size-4" />}
        action={
          <Link href="/requests" className="text-xs font-medium text-brand hover:underline">
            {t("seeAll")}
          </Link>
        }
      />
      {rows.length === 0 ? (
        <p className="py-4 text-center text-sm text-muted-foreground">{t("noRequests")}</p>
      ) : (
        <ul className="space-y-3">
          {rows.map((r) => {
            const restricted = isRestrictedForViewer(ctx, r);
            const done = ["COMPLETED", "REJECTED", "CANCELLED"].includes(r.status);
            return (
              <li key={r.id}>
                <Link href={`/requests/${r.id}`} className="block rounded-lg border p-3 transition hover:border-brand/30 hover:bg-muted/30" data-testid="home-request">
                  <div className="flex items-start gap-3">
                    <span className="grid size-8 shrink-0 place-items-center rounded-md bg-brand-soft text-brand">
                      <Icon name={r.service.icon} className="size-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <span className="truncate text-sm font-medium">{pick(ctx.locale, r.service.nameEn, r.service.nameAr)}</span>
                        <RequestStatusBadge status={r.status} restricted={restricted} />
                      </div>
                      <div className="mt-0.5 truncate text-xs text-muted-foreground">
                        {!restricted && !done && r.currentStepEn ? pick(ctx.locale, r.currentStepEn, r.currentStepAr) : fmtDateTime(prefs, r.updatedAt)}
                        {r.student && !ctx.isStudent ? ` · ${personName(r.student, ctx.locale)}` : ""}
                      </div>
                      {!restricted && (
                        <div className="mt-2 h-1 overflow-hidden rounded-full bg-muted">
                          <div className={r.status === "REJECTED" ? "h-full bg-danger/60" : "h-full bg-success"} style={{ width: `${done ? 100 : Math.max(8, r.progress)}%` }} />
                        </div>
                      )}
                    </div>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}

export async function QuickServices({ ctx, keys, title }: { ctx: Ctx; keys: string[]; title?: string }) {
  const t = await getTranslations("home");
  const services = await ctx.db.serviceDefinition.findMany({ where: { orgId: ctx.orgId, key: { in: keys }, isActive: true, audience: { hasSome: ctx.roles } } });
  const ordered = keys.map((k) => services.find((s) => s.key === k)).filter(Boolean) as typeof services;
  return (
    <Panel>
      <PanelHeader
        title={title ?? t("quickServices")}
        action={
          <Link href="/services" className="flex items-center gap-1 text-xs font-medium text-brand hover:underline">
            {t("allServices")}
            <ArrowRight className="size-3 rtl:rotate-180" />
          </Link>
        }
      />
      <div className="grid grid-cols-2 gap-2">
        {ordered.map((s) => (
          <Link key={s.key} href={`/services/${s.key}`} data-testid={`quick-${s.key}`} className="group flex flex-col gap-2 rounded-lg border p-3 transition hover:border-brand/30 hover:bg-brand-soft/30">
            <span className={cn("grid size-8 place-items-center rounded-md", s.sensitivity === "SAFEGUARDING" ? "bg-danger-soft text-danger" : "bg-brand-soft text-brand")}>
              <Icon name={s.icon} className="size-4" />
            </span>
            <span className="text-sm font-medium leading-snug">{pick(ctx.locale, s.nameEn, s.nameAr)}</span>
          </Link>
        ))}
      </div>
    </Panel>
  );
}

export async function AnnouncementsPanel({ ctx, prefs, audience }: { ctx: Ctx; prefs: FormatPrefs; audience: string }) {
  const t = await getTranslations("home");
  const items = await ctx.db.announcement.findMany({ where: { orgId: ctx.orgId, audience: { hasSome: ["all", audience] } }, orderBy: { publishedAt: "desc" }, take: 3 });
  if (!items.length) return null;
  return (
    <Panel>
      <PanelHeader title={t("announcements")} icon={<Megaphone className="size-4" />} />
      <ul className="space-y-4">
        {items.map((a) => (
          <li key={a.id}>
            <div className="text-sm font-medium">{pick(ctx.locale, a.titleEn, a.titleAr)}</div>
            <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{pick(ctx.locale, a.bodyEn, a.bodyAr)}</p>
            <div className="mt-1 text-[11px] text-muted-foreground">{fmtRelative(prefs, a.publishedAt)}</div>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
