import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Mail } from "lucide-react";
import { getCtx } from "@/server/context";
import { formatPrefs } from "@/server/format";
import { fmtDate } from "@/lib/format";
import { personName, pick } from "@/lib/i18n-data";
import { PageBody, PageHeader } from "@/components/app/page-header";
import { EmptyState } from "@/components/app/empty-state";
import { Pill } from "@/components/app/badges";
import { UrgencyPill } from "@/components/applications/app-ui";
import { MarkSentButton } from "@/components/applications/app-client";
import { LETTERS_HREF } from "@/server/applications/service";
import { urgencyFor } from "@/server/applications/deadlines";

export async function generateMetadata() {
  const t = await getTranslations("applications");
  return { title: t("lettersTitle") };
}

/** Recommendation letters a counselor asked this staff member to write. Only the requests: never letter content. */
export default async function LettersPage() {
  const ctx = await getCtx();
  if (!ctx.isStaff) notFound();
  const t = await getTranslations("applications");
  const prefs = await formatPrefs(ctx);
  const { db, orgId, locale, membershipId } = ctx;
  const now = new Date();
  const tasks = await db.task.findMany({ where: { orgId, assigneeId: membershipId, href: LETTERS_HREF, status: { in: ["TODO", "IN_PROGRESS", "DONE"] } }, orderBy: [{ status: "desc" }, { dueAt: "asc" }], take: 200 });
  const items = tasks.length ? await db.applicationRequirement.findMany({ where: { orgId, taskId: { in: tasks.map((x) => x.id) } }, include: { application: true } }) : [];
  const [students, unis] = await Promise.all([
    db.student.findMany({ where: { id: { in: items.map((i) => i.application.studentId) } } }),
    db.university.findMany({ where: { id: { in: items.map((i) => i.application.universityId) } }, select: { id: true, nameEn: true, nameAr: true } }),
  ]);
  const rows = tasks
    .map((task) => {
      const item = items.find((i) => i.taskId === task.id);
      if (!item) return null;
      return { task, item, student: students.find((s) => s.id === item.application.studentId), uni: unis.find((u) => u.id === item.application.universityId) };
    })
    .filter((r): r is NonNullable<typeof r> => !!r)
    .sort((a, b) => Number(a.task.status === "DONE") - Number(b.task.status === "DONE"));

  return (
    <PageBody className="max-w-4xl">
      <PageHeader title={t("lettersTitle")} description={t("lettersSubtitle")} />
      {rows.length === 0 ? (
        <EmptyState icon={<Mail className="size-5" />} title={t("noLetters")} body={t("noLettersBody")} />
      ) : (
        <ul className="divide-y overflow-hidden rounded-xl border bg-card shadow-xs" data-testid="letter-list">
          {rows.map(({ task, item, student, uni }) => {
            const u = task.status !== "DONE" && task.dueAt ? urgencyFor(task.dueAt, now) : null;
            return (
              <li key={task.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center" data-testid="letter-row">
                <div className="min-w-0 flex-1">
                  <div className="font-medium">{student ? personName(student, locale) : ""}</div>
                  <div className="text-sm text-muted-foreground">
                    {uni ? pick(locale, uni.nameEn, uni.nameAr) : ""} · {pick(locale, item.titleEn, item.titleAr)}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                    {task.dueAt && <span>{t("due", { date: fmtDate(prefs, task.dueAt) })}</span>}
                    {u && <UrgencyPill bucket={u.bucket} days={u.days} />}
                  </div>
                </div>
                {task.status === "DONE" ? <Pill tone="success">{t("sent")}</Pill> : <MarkSentButton taskId={task.id} />}
              </li>
            );
          })}
        </ul>
      )}
    </PageBody>
  );
}
