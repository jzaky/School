import { getTranslations } from "next-intl/server";
import { CheckCheck, ExternalLink, PenLine } from "lucide-react";
import { getCtx } from "@/server/context";
import { formatPrefs } from "@/server/format";
import { fmtDate, fmtRelative } from "@/lib/format";
import { pick, userName } from "@/lib/i18n-data";
import { Link } from "@/i18n/navigation";
import { PageBody, PageHeader, SectionTitle } from "@/components/app/page-header";
import { Panel } from "@/components/app/panel";
import { EmptyState } from "@/components/app/empty-state";
import { Pill } from "@/components/app/badges";
import { Icon } from "@/components/icon";
import { ApprovalPanel } from "@/components/requests/approval-panel";
import { formatAnswers } from "@/server/forms/answers";
import type { FormSchema } from "@/server/forms/schema";

export async function generateMetadata() {
  const t = await getTranslations("approvals");
  return { title: t("title") };
}

export default async function ApprovalsPage() {
  const ctx = await getCtx();
  const t = await getTranslations("approvals");
  const ts = await getTranslations("status");
  const prefs = await formatPrefs(ctx);
  const { db, orgId, locale } = ctx;
  const [pending, recent] = await Promise.all([
    db.approvalAssignee.findMany({
      where: { orgId, membershipId: ctx.membershipId, status: "PENDING", approval: { status: "PENDING" } },
      include: { approval: { include: { request: { include: { service: true, student: true, submission: { include: { formVersion: true } } } } } } },
      orderBy: { approval: { createdAt: "asc" } },
    }),
    db.approvalAssignee.findMany({
      where: { orgId, membershipId: ctx.membershipId, status: { in: ["APPROVED", "REJECTED"] } },
      include: { approval: { include: { request: true } } },
      orderBy: { decidedAt: "desc" },
      take: 10,
    }),
  ]);
  const requesterIds = [...new Set(pending.map((p) => p.approval.request?.requesterId).filter(Boolean))] as string[];
  const requesters = requesterIds.length ? await db.membership.findMany({ where: { id: { in: requesterIds } }, include: { user: true } }) : [];
  const cards = await Promise.all(
    pending.map(async (p) => {
      const r = p.approval.request;
      const answers = r?.submission ? (await formatAnswers(ctx, r.submission.formVersion.schema as unknown as FormSchema, r.submission.data as Record<string, unknown>)).filter((a) => a.kind !== "signature").slice(0, 6) : [];
      return { p, r, answers };
    }),
  );
  return (
    <PageBody className="max-w-5xl">
      <PageHeader title={t("title")} description={t("subtitle")} />
      <section>
        <SectionTitle>
          {t("pending")} <span className="ms-1 text-muted-foreground tabular-nums">{pending.length}</span>
        </SectionTitle>
        {cards.length === 0 ? (
          <EmptyState icon={<CheckCheck className="size-5" />} title={t("empty")} body={t("emptyBody")} />
        ) : (
          <div className="space-y-4">
            {cards.map(({ p, r, answers }) => {
              const requester = requesters.find((m) => m.id === r?.requesterId);
              return (
                <Panel key={p.id} padded={false} className="overflow-hidden" >
                  <div className="grid lg:grid-cols-[minmax(0,1fr)_340px]" data-testid="approval-card">
                    <div className="space-y-4 p-5">
                      <div className="flex items-start gap-3">
                        <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-brand-soft text-brand">
                          <Icon name={r?.service.icon ?? "stamp"} className="size-5" />
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-mono text-xs text-muted-foreground" dir="ltr">
                              {r?.number}
                            </span>
                            <Pill tone="warning">{pick(locale, p.labelEn, p.labelAr)}</Pill>
                            {p.requireSignature && (
                              <Pill tone="brand">
                                <PenLine className="size-3" />
                                {t("needsSignature")}
                              </Pill>
                            )}
                          </div>
                          <h3 className="mt-1 font-semibold">{r ? pick(locale, r.titleEn, r.titleAr) : pick(locale, p.approval.titleEn, p.approval.titleAr)}</h3>
                          <p className="text-xs text-muted-foreground">
                            {requester && t("requestedBy", { name: userName(requester.user, locale) })} · {fmtRelative(prefs, p.approval.createdAt)}
                            {p.approval.dueAt && ` · ${t("due", { date: fmtDate(prefs, p.approval.dueAt, "short") })}`}
                          </p>
                        </div>
                      </div>
                      {answers.length > 0 && (
                        <dl className="grid gap-x-6 gap-y-3 rounded-lg bg-muted/40 p-4 sm:grid-cols-2">
                          {answers.map((a) => (
                            <div key={a.id} className={a.kind === "long" ? "sm:col-span-2" : ""}>
                              <dt className="text-xs text-muted-foreground">{a.label}</dt>
                              <dd className="line-clamp-3 text-sm">{a.value}</dd>
                            </div>
                          ))}
                        </dl>
                      )}
                      {r && (
                        <Link href={`/requests/${r.id}`} className="inline-flex items-center gap-1 text-sm font-medium text-brand hover:underline">
                          {t("openRequest")}
                          <ExternalLink className="size-3.5 rtl:-scale-x-100" />
                        </Link>
                      )}
                    </div>
                    <div className="border-t bg-muted/20 p-5 lg:border-t-0 lg:border-s">
                      <ApprovalPanel assigneeRowId={p.id} label={pick(locale, p.labelEn, p.labelAr)} requireSignature={p.requireSignature} signerName={userName(ctx.user, locale)} compact />
                    </div>
                  </div>
                </Panel>
              );
            })}
          </div>
        )}
      </section>
      {recent.length > 0 && (
        <section>
          <SectionTitle>{t("recent")}</SectionTitle>
          <Panel padded={false}>
            <ul className="divide-y">
              {recent.map((d) => (
                <li key={d.id}>
                  <Link href={d.approval.requestId ? `/requests/${d.approval.requestId}` : "/approvals"} className="flex items-center gap-3 px-5 py-3 text-sm hover:bg-muted/40">
                    <Pill tone={d.status === "APPROVED" ? "success" : "danger"} dot>
                      {ts(`approval.${d.status}`)}
                    </Pill>
                    <span className="min-w-0 flex-1 truncate">{d.approval.request ? pick(locale, d.approval.request.titleEn, d.approval.request.titleAr) : pick(locale, d.approval.titleEn, d.approval.titleAr)}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">{d.decidedAt ? fmtRelative(prefs, d.decidedAt) : ""}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </Panel>
        </section>
      )}
    </PageBody>
  );
}
