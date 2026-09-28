import type { Prisma } from "@prisma/client";
import { getTranslations } from "next-intl/server";
import { CheckSquare } from "lucide-react";
import { getCtx } from "@/server/context";
import { formatPrefs } from "@/server/format";
import { fmtDate, fmtRelative } from "@/lib/format";
import { personName, pick, userName } from "@/lib/i18n-data";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { PageBody, PageHeader } from "@/components/app/page-header";
import { FilterBar } from "@/components/app/filter-bar";
import { EmptyState } from "@/components/app/empty-state";
import { PriorityBadge } from "@/components/app/badges";
import { TaskCheck } from "@/components/dashboard/task-check";
import { listableCaseWhere } from "@/server/access/case-access";

export async function generateMetadata() {
  const t = await getTranslations("tasks");
  return { title: t("title") };
}

export default async function TasksPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const sp = await searchParams;
  const ctx = await getCtx();
  const t = await getTranslations("tasks");
  const prefs = await formatPrefs(ctx);
  const { db, orgId, membershipId, locale } = ctx;
  const view = sp.view ?? "mine";
  const now = new Date();
  const endToday = new Date(new Date(now.getTime() + 4 * 3600_000).setUTCHours(23, 59, 59) - 4 * 3600_000);
  const open: Prisma.TaskWhereInput = { status: { in: ["TODO", "IN_PROGRESS"] } };
  // "Team" is tasks on cases the member can work on, never tasks on cases they cannot see.
  const teamCases = ctx.isStaff && view === "team" ? await db.case.findMany({ where: listableCaseWhere(ctx, "worklist"), select: { id: true } }) : [];
  const where: Prisma.TaskWhereInput =
    view === "team"
      ? { orgId, ...open, caseId: { in: teamCases.map((c) => c.id) } }
      : view === "overdue"
        ? { orgId, assigneeId: membershipId, ...open, dueAt: { lt: now } }
        : view === "today"
          ? { orgId, assigneeId: membershipId, ...open, dueAt: { gte: new Date(endToday.getTime() - 86400_000), lte: endToday } }
          : view === "upcoming"
            ? { orgId, assigneeId: membershipId, ...open, dueAt: { gt: endToday } }
            : view === "done"
              ? { orgId, assigneeId: membershipId, status: "DONE" }
              : { orgId, assigneeId: membershipId, ...open };
  const [tasks, overdueCount] = await Promise.all([
    db.task.findMany({ where, orderBy: view === "done" ? { completedAt: "desc" } : [{ dueAt: { sort: "asc", nulls: "last" } }], take: 100 }),
    db.task.count({ where: { orgId, assigneeId: membershipId, ...open, dueAt: { lt: now } } }),
  ]);
  const students = await db.student.findMany({ where: { id: { in: tasks.map((x) => x.studentId).filter(Boolean) as string[] } } });
  const people = view === "team" ? await db.membership.findMany({ where: { id: { in: tasks.map((x) => x.assigneeId).filter(Boolean) as string[] } }, include: { user: true } }) : [];
  return (
    <PageBody className="max-w-5xl">
      <PageHeader title={t("title")} description={t("subtitle")} />
      <FilterBar
        tabParam="view"
        tabs={[
          { value: "mine", label: t("mine") },
          { value: "today", label: t("today") },
          { value: "overdue", label: t("overdue"), count: overdueCount },
          { value: "upcoming", label: t("upcoming") },
          ...(ctx.isStaff ? [{ value: "team", label: t("team") }] : []),
          { value: "done", label: t("done") },
        ]}
      />
      {tasks.length === 0 ? (
        <EmptyState icon={<CheckSquare className="size-5" />} title={t("empty")} body={t("emptyBody")} />
      ) : (
        <ul className="divide-y overflow-hidden rounded-xl border bg-card shadow-xs">
          {tasks.map((task) => {
            const overdue = task.status !== "DONE" && task.dueAt && task.dueAt < now;
            const student = students.find((s) => s.id === task.studentId);
            const title = pick(locale, task.titleEn, task.titleAr);
            const owner = people.find((p) => p.id === task.assigneeId);
            return (
              <li key={task.id} className="flex items-center gap-3 px-4 py-3 sm:px-5" data-testid="task-row">
                <TaskCheck id={task.id} done={task.status === "DONE"} label={title} />
                <div className="min-w-0 flex-1">
                  {task.href ? (
                    <Link href={task.href} className={cn("block truncate text-sm font-medium hover:text-brand", task.status === "DONE" && "text-muted-foreground line-through")}>
                      {title}
                    </Link>
                  ) : (
                    <span className={cn("block truncate text-sm font-medium", task.status === "DONE" && "text-muted-foreground line-through")}>{title}</span>
                  )}
                  <div className="flex flex-wrap gap-x-2 text-xs text-muted-foreground">
                    {student && ctx.isStaff && <span>{personName(student, locale)}</span>}
                    {owner && <span>· {userName(owner.user, locale)}</span>}
                    {task.dueAt && <span className={overdue ? "font-medium text-danger" : ""}>{overdue ? t("overdueWhen", { when: fmtRelative(prefs, task.dueAt) }) : t("due", { date: fmtDate(prefs, task.dueAt) })}</span>}
                  </div>
                </div>
                {(task.priority === "HIGH" || task.priority === "URGENT") && <PriorityBadge priority={task.priority} />}
              </li>
            );
          })}
        </ul>
      )}
    </PageBody>
  );
}
