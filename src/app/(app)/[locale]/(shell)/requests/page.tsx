import type { Prisma } from "@prisma/client";
import { getTranslations } from "next-intl/server";
import { Inbox, Lock, MessagesSquare, Plus } from "lucide-react";
import { getCtx } from "@/server/context";
import { formatPrefs } from "@/server/format";
import { fmtDate } from "@/lib/format";
import { personName, pick } from "@/lib/i18n-data";
import { Link } from "@/i18n/navigation";
import { PageBody, PageHeader } from "@/components/app/page-header";
import { FilterBar } from "@/components/app/filter-bar";
import { EmptyState } from "@/components/app/empty-state";
import { RequestStatusBadge } from "@/components/app/badges";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/icon";
import { requestWhere, isRestrictedForViewer } from "@/server/access/request-access";
import { unreadByRequest } from "@/server/requests/conversation";
import { absencePrivacy, canSeeAbsenceReason } from "@/server/access/absence-access";

export async function generateMetadata() {
  const t = await getTranslations("requests");
  return { title: t("title") };
}

export default async function RequestsPage({ searchParams }: { searchParams: Promise<{ tab?: string; status?: string; q?: string }> }) {
  const sp = await searchParams;
  const ctx = await getCtx();
  const t = await getTranslations("requests");
  const prefs = await formatPrefs(ctx);
  const { db, locale } = ctx;
  const base = requestWhere(ctx);
  const tab = sp.tab ?? "mine";
  const tabWhere: Prisma.RequestWhereInput =
    tab === "waiting"
      ? { approvals: { some: { status: "PENDING", assignees: { some: { membershipId: ctx.membershipId, status: "PENDING" } } } } }
      : tab === "all" || tab === "children"
        ? {}
        : ctx.isStudent
          ? {}
          : { requesterId: ctx.membershipId };
  const statusWhere: Prisma.RequestWhereInput =
    sp.status === "open"
      ? { status: { notIn: ["COMPLETED", "REJECTED", "CANCELLED"] } }
      : sp.status === "closed"
        ? { status: { in: ["COMPLETED", "REJECTED", "CANCELLED"] } }
        : sp.status === "overdue"
          ? { status: { notIn: ["COMPLETED", "REJECTED", "CANCELLED"] }, slaDueAt: { lt: new Date() } }
          : {};
  const q = sp.q?.trim();
  const searchWhere: Prisma.RequestWhereInput = q
    ? { OR: [{ number: { contains: q, mode: "insensitive" } }, { titleEn: { contains: q, mode: "insensitive" } }, { titleAr: { contains: q, mode: "insensitive" } }] }
    : {};
  const where: Prisma.RequestWhereInput = { AND: [base, tabWhere, statusWhere, searchWhere] };
  const [rows, mineCount, waitingCount] = await Promise.all([
    db.request.findMany({ where, include: { service: true, student: true }, orderBy: { submittedAt: "desc" }, take: 60 }),
    db.request.count({ where: { AND: [base, ctx.isStudent ? {} : { requesterId: ctx.membershipId }, { status: { notIn: ["COMPLETED", "REJECTED", "CANCELLED"] } }] } }),
    db.request.count({ where: { AND: [base, { approvals: { some: { status: "PENDING", assignees: { some: { membershipId: ctx.membershipId, status: "PENDING" } } } } }] } }),
  ]);
  const tabs = [
    { value: "mine", label: ctx.isStudent ? t("myTitle") : t("tabMine"), count: mineCount },
    ...(ctx.isStudent ? [] : [{ value: "waiting", label: t("tabWaiting"), count: waitingCount }]),
    ...(ctx.isParent ? [{ value: "children", label: t("tabChildren") }] : ctx.isStaff ? [{ value: "all", label: t("tabAll") }] : []),
  ];
  const now = Date.now();
  // Unread conversation messages, and absence requests whose reason is private to this viewer.
  const unread = await unreadByRequest(ctx, rows);
  const privateIds = ctx.isStaff ? rows.filter((r) => absencePrivacy(r.service.key)).map((r) => r.id) : [];
  const approverOf = privateIds.length
    ? new Set((await db.approvalAssignee.findMany({ where: { membershipId: ctx.membershipId, approval: { requestId: { in: privateIds } } }, select: { approval: { select: { requestId: true } } } })).map((a) => a.approval.requestId))
    : new Set<string>();
  const submissions = privateIds.length ? await db.submission.findMany({ where: { request: { id: { in: privateIds } } }, select: { data: true, request: { select: { id: true } } } }) : [];
  const dataOf = new Map(submissions.map((x) => [x.request?.id ?? "", x.data as Record<string, unknown>]));
  const reasonHidden = new Set(privateIds.filter((id) => {
    const r = rows.find((x) => x.id === id)!;
    return !canSeeAbsenceReason(ctx, r, dataOf.get(id) ?? null, { approver: approverOf.has(id) });
  }));
  const parentRequesters = reasonHidden.size
    ? new Set((await db.membershipRole.findMany({ where: { role: { key: "parent" }, membershipId: { in: rows.filter((r) => reasonHidden.has(r.id)).map((r) => r.requesterId) } }, select: { membershipId: true } })).map((x) => x.membershipId))
    : new Set<string>();
  return (
    <PageBody>
      <PageHeader
        title={ctx.isStudent ? t("myTitle") : t("title")}
        description={t("subtitle")}
        actions={
          <Button asChild>
            <Link href="/services">
              <Plus className="size-4" />
              {t("newRequest")}
            </Link>
          </Button>
        }
      />
      <FilterBar
        tabs={tabs}
        chips={[
          { value: "", label: t("allStatuses") },
          { value: "open", label: t("open") },
          { value: "overdue", label: t("overdue") },
          { value: "closed", label: t("closed") },
        ]}
        searchPlaceholder={t("searchPlaceholder")}
      />
      {rows.length === 0 ? (
        <EmptyState icon={<Inbox className="size-5" />} title={t("empty")} body={t("emptyBody")} />
      ) : (
        <div className="overflow-hidden rounded-xl border bg-card shadow-xs">
          <ul className="divide-y">
            {rows.map((r) => {
              const restricted = isRestrictedForViewer(ctx, r);
              const open = !["COMPLETED", "REJECTED", "CANCELLED"].includes(r.status);
              const late = open && r.slaDueAt && r.slaDueAt.getTime() < now;
              return (
                <li key={r.id}>
                  <Link href={`/requests/${r.id}`} className="grid gap-3 px-4 py-3.5 transition hover:bg-muted/40 sm:grid-cols-[minmax(0,1fr)_170px_150px_110px] sm:items-center sm:px-5" data-testid="request-row">
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-brand-soft text-brand">
                        <Icon name={r.service.icon} className="size-4" />
                      </span>
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium">{pick(locale, r.titleEn, r.titleAr)}</div>
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                          <span className="font-mono" dir="ltr">
                            {r.number}
                          </span>
                          {r.student && !ctx.isStudent && <span className="truncate">· {personName(r.student, locale)}</span>}
                          {(unread.get(r.id) ?? 0) > 0 && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-brand px-1.5 py-px text-[10px] font-semibold text-brand-foreground" data-testid="unread-badge">
                              <MessagesSquare className="size-3" />
                              {t("unreadN", { n: unread.get(r.id) ?? 0 })}
                            </span>
                          )}
                          {reasonHidden.has(r.id) && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-violet-50 px-1.5 py-px text-[10px] font-medium text-violet-700 ring-1 ring-inset ring-violet-200" data-testid="reason-private-pill">
                              <Lock className="size-3" />
                              {t("reasonPrivate")}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="min-w-0">
                      <RequestStatusBadge status={r.status} restricted={restricted} />
                      {open && !restricted && r.currentStepEn && <div className="mt-1 truncate text-xs text-muted-foreground">{pick(locale, r.currentStepEn, r.currentStepAr)}</div>}
                      {reasonHidden.has(r.id) && r.service.key === "absence_request" && r.status === "COMPLETED" && (
                        <div className="mt-1 truncate text-xs text-muted-foreground" data-testid="excused-label">{parentRequesters.has(r.requesterId) ? t("privacy.excusedByParent") : t("privacy.excusedByStudent")}</div>
                      )}
                    </div>
                    <div className="hidden sm:block">
                      {!restricted && (
                        <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                          <div className={late ? "h-full rounded-full bg-warning" : r.status === "REJECTED" ? "h-full rounded-full bg-danger/60" : "h-full rounded-full bg-success"} style={{ width: `${r.status === "COMPLETED" || r.status === "REJECTED" ? 100 : Math.max(r.progress, 8)}%` }} />
                        </div>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground sm:text-end">
                      {fmtDate(prefs, r.submittedAt)}
                      {late && <div className="font-medium text-[oklch(0.55_0.14_65)]">{t("overdue")}</div>}
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </PageBody>
  );
}
