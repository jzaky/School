import type { Prisma } from "@prisma/client";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { FolderKanban } from "lucide-react";
import { getCtx } from "@/server/context";
import { formatPrefs } from "@/server/format";
import { fmtRelative } from "@/lib/format";
import { initials, personName, pick, userName } from "@/lib/i18n-data";
import { Link } from "@/i18n/navigation";
import { PageBody, PageHeader } from "@/components/app/page-header";
import { FilterBar } from "@/components/app/filter-bar";
import { EmptyState } from "@/components/app/empty-state";
import { CaseStatusBadge, Pill, PriorityBadge, SensitivityBadge } from "@/components/app/badges";
import { SlaCountdown } from "@/components/cases/sla";
import { listableCaseWhere } from "@/server/access/case-access";

export async function generateMetadata() {
  const t = await getTranslations("cases");
  return { title: t("title") };
}

const OPEN = ["NEW", "OPEN", "IN_PROGRESS", "WAITING"] as const;

export default async function CasesPage({ searchParams }: { searchParams: Promise<{ view?: string; type?: string; q?: string; priority?: string }> }) {
  const sp = await searchParams;
  const ctx = await getCtx();
  if (!ctx.can("cases.view")) notFound();
  const t = await getTranslations("cases");
  const ts = await getTranslations("status");
  const prefs = await formatPrefs(ctx);
  const { db, orgId, membershipId, locale } = ctx;
  const base = listableCaseWhere(ctx, "worklist");
  const now = new Date();
  const saved = await db.savedView.findMany({ where: { orgId, entity: "case", OR: [{ isShared: true }, { membershipId }] }, orderBy: { sortOrder: "asc" } });
  const view = sp.view ?? "mine";
  const savedView = saved.find((s) => s.id === view);
  const viewWhere: Prisma.CaseWhereInput = savedView
    ? (savedView.filters as Prisma.CaseWhereInput)
    : view === "mine"
      ? { assigneeId: membershipId, status: { in: [...OPEN] } }
      : view === "team"
        ? { status: { in: [...OPEN] } }
        : view === "followups"
          ? { status: { in: [...OPEN] }, nextFollowUpAt: { lt: new Date(now.getTime() + 2 * 86400_000) } }
          : view === "closed"
            ? { status: { in: ["RESOLVED", "CLOSED"] } }
            : {};
  const typeWhere: Prisma.CaseWhereInput = sp.type ? { type: sp.type as never } : {};
  const prioWhere: Prisma.CaseWhereInput = sp.priority === "high" ? { priority: { in: ["HIGH", "URGENT"] } } : {};
  const q = sp.q?.trim();
  const searchWhere: Prisma.CaseWhereInput = q
    ? { OR: [{ number: { contains: q, mode: "insensitive" } }, { student: { OR: [{ firstNameEn: { contains: q, mode: "insensitive" } }, { lastNameEn: { contains: q, mode: "insensitive" } }, { firstNameAr: { contains: q } }, { lastNameAr: { contains: q } }] } }] }
    : {};
  const [rows, mineCount] = await Promise.all([
    db.case.findMany({ where: { AND: [base, viewWhere, typeWhere, prioWhere, searchWhere] }, include: { student: true }, orderBy: [{ priority: "desc" }, { openedAt: "desc" }], take: 80 }),
    db.case.count({ where: { AND: [base, { assigneeId: membershipId, status: { in: [...OPEN] } }] } }),
  ]);
  const assignees = await db.membership.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.assigneeId).filter(Boolean))] as string[] } }, include: { user: true } });
  const types = ["ACADEMIC", "BEHAVIOR", "WELLBEING", "CAREER", "LEARNING_SUPPORT", "ATTENDANCE"];
  return (
    <PageBody>
      <PageHeader title={t("title")} description={t("subtitle")} />
      <FilterBar
        tabParam="view"
        chipParam="type"
        tabs={[
          { value: "mine", label: t("viewMine"), count: mineCount },
          { value: "team", label: t("viewTeam") },
          { value: "followups", label: t("viewFollowups") },
          { value: "closed", label: t("viewClosed") },
          ...saved.map((s) => ({ value: s.id, label: pick(locale, s.nameEn, s.nameAr) })),
        ]}
        chips={[{ value: "", label: t("allTypes") }, ...types.map((x) => ({ value: x, label: ts(`caseType.${x}`) }))]}
        searchPlaceholder={t("search")}
      />
      {rows.length === 0 ? (
        <EmptyState icon={<FolderKanban className="size-5" />} title={t("empty")} body={t("emptyBody")} />
      ) : (
        <div className="overflow-x-auto rounded-xl border bg-card shadow-xs">
          <table className="w-full min-w-[860px] text-sm">
            <thead className="border-b bg-muted/40 text-xs text-muted-foreground">
              <tr className="[&>th]:px-4 [&>th]:py-2.5 [&>th]:text-start [&>th]:font-medium">
                <th>{t("colStudent")}</th>
                <th>{t("colCase")}</th>
                <th>{t("colAssignee")}</th>
                <th>{t("colPriority")}</th>
                <th>{t("colStatus")}</th>
                <th>{t("colSla")}</th>
                <th>{t("colOpened")}</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((c) => {
                const a = assignees.find((m) => m.id === c.assigneeId);
                const closed = c.status === "RESOLVED" || c.status === "CLOSED";
                return (
                  <tr key={c.id} className="group transition hover:bg-muted/30 [&>td]:px-4 [&>td]:py-3" data-testid="case-row">
                    <td>
                      <Link href={`/cases/${c.id}`} className="flex items-center gap-3">
                        <span className="grid size-8 shrink-0 place-items-center rounded-full bg-brand-soft text-[11px] font-semibold text-brand">{initials(`${c.student.firstNameEn} ${c.student.lastNameEn}`)}</span>
                        <span className="min-w-0">
                          <span className="block truncate font-medium group-hover:text-brand">{personName(c.student, locale)}</span>
                          <span className="text-xs text-muted-foreground">
                            {t("grade", { grade: `${c.student.gradeLevel}${c.student.section ?? ""}` })}
                          </span>
                        </span>
                      </Link>
                    </td>
                    <td>
                      <Link href={`/cases/${c.id}`} className="block">
                        <span className="block max-w-64 truncate">{pick(locale, c.titleEn, c.titleAr)}</span>
                        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          <span className="font-mono" dir="ltr">
                            {c.number}
                          </span>
                          <Pill className="py-0">{ts(`caseType.${c.type}`)}</Pill>
                          <SensitivityBadge sensitivity={c.sensitivity} />
                        </span>
                      </Link>
                    </td>
                    <td className="text-muted-foreground">{a ? userName(a.user, locale) : "-"}</td>
                    <td>
                      <PriorityBadge priority={c.priority} />
                    </td>
                    <td>
                      <CaseStatusBadge status={c.status} />
                    </td>
                    <td>
                      <SlaCountdown due={c.slaDueAt} closed={closed} />
                    </td>
                    <td className="text-xs text-muted-foreground">{fmtRelative(prefs, c.openedAt)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </PageBody>
  );
}
