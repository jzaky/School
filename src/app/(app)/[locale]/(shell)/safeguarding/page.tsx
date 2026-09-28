import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { MessageCircleHeart, Phone, ShieldAlert, ShieldCheck } from "lucide-react";
import { getCtx } from "@/server/context";
import { formatPrefs } from "@/server/format";
import { fmtRelative } from "@/lib/format";
import { personName, pick, userName } from "@/lib/i18n-data";
import { Link } from "@/i18n/navigation";
import { PageBody, PageHeader } from "@/components/app/page-header";
import { Panel, PanelHeader } from "@/components/app/panel";
import { CaseStatusBadge, Pill, RequestStatusBadge } from "@/components/app/badges";
import { EmptyState } from "@/components/app/empty-state";
import { Button } from "@/components/ui/button";
import { listableCaseWhere } from "@/server/access/case-access";

export async function generateMetadata() {
  const t = await getTranslations("safeguarding");
  return { title: t("title") };
}

export default async function SafeguardingPage() {
  const ctx = await getCtx();
  if (!ctx.isStaff || !(ctx.can("safeguarding.refer") || ctx.can("safeguarding.view"))) notFound();
  const t = await getTranslations("safeguarding");
  const prefs = await formatPrefs(ctx);
  const { db, orgId, locale } = ctx;
  const [cases, myConcerns, dsl] = await Promise.all([
    db.case.findMany({ where: listableCaseWhere(ctx, "safeguarding"), include: { student: true }, orderBy: [{ status: "asc" }, { openedAt: "desc" }] }),
    db.request.findMany({ where: { orgId, requesterId: ctx.membershipId, service: { key: "safeguarding_concern" } }, include: { student: true }, orderBy: { submittedAt: "desc" } }),
    db.membershipRole.findMany({ where: { orgId, role: { key: { in: ["dsl", "deputy_dsl"] } } }, include: { role: true, membership: { include: { user: true, staffProfile: true } } } }),
  ]);
  return (
    <PageBody>
      <PageHeader
        title={t("title")}
        description={t("subtitle")}
        actions={
          <Button asChild className="bg-danger text-white hover:bg-danger/90" data-testid="raise-concern">
            <Link href="/services/safeguarding_concern">
              <ShieldAlert className="size-4" />
              {t("raise")}
            </Link>
          </Button>
        }
      />
      <div className="grid gap-4 md:grid-cols-2">
        {dsl.map((d) => (
          <Panel key={d.id} className="flex items-center gap-4">
            <span className="grid size-11 place-items-center rounded-full bg-danger-soft text-danger">
              <ShieldCheck className="size-5" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-xs text-muted-foreground">{pick(locale, d.role.nameEn, d.role.nameAr)}</div>
              <div className="font-semibold">{userName(d.membership.user, locale)}</div>
            </div>
            {d.membership.staffProfile?.phone && (
              <a href={`tel:${d.membership.staffProfile.phone.replace(/\s/g, "")}`} className="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm hover:bg-muted" dir="ltr">
                <Phone className="size-3.5" />
                {d.membership.staffProfile.phone}
              </a>
            )}
          </Panel>
        ))}
      </div>
      {ctx.can("safeguarding.view") || cases.length > 0 ? (
        <Panel padded={false}>
          <div className="border-b px-5 py-4">
            <PanelHeader title={t("cases")} description={t("casesHint")} />
          </div>
          {cases.length === 0 ? (
            <div className="p-6">
              <EmptyState title={t("noCases")} />
            </div>
          ) : (
            <ul className="divide-y">
              {cases.map((c) => (
                <li key={c.id}>
                  <Link href={`/cases/${c.id}`} className="flex items-center gap-4 px-5 py-3.5 hover:bg-muted/30" data-testid="sg-row">
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium">{personName(c.student, locale)}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        <span className="font-mono" dir="ltr">
                          {c.number}
                        </span>{" "}
                        · {pick(locale, c.titleEn, c.titleAr)} · {fmtRelative(prefs, c.openedAt)}
                      </span>
                    </span>
                    {c.concernLevel && <Pill tone={c.concernLevel === "IMMEDIATE_DANGER" ? "danger" : c.concernLevel === "HIGH" ? "warning" : "info"}>{t(`level.${c.concernLevel}`)}</Pill>}
                    <CaseStatusBadge status={c.status} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      ) : null}
      <Panel>
        <PanelHeader title={t("myConcerns")} description={t("myConcernsHint")} />
        {myConcerns.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("noMyConcerns")}</p>
        ) : (
          <ul className="divide-y">
            {myConcerns.map((r) => (
              <li key={r.id}>
                <Link href={`/requests/${r.id}`} className="flex items-center gap-3 py-3 text-sm hover:text-brand" data-testid="my-concern">
                  <span className="flex-1">
                    {r.student ? personName(r.student, locale) : ""} · {fmtRelative(prefs, r.submittedAt)}
                  </span>
                  <RequestStatusBadge status={r.status} restricted={!ctx.can("safeguarding.view")} />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Panel>
      <Panel className="flex items-start gap-3 bg-muted/30">
        <MessageCircleHeart className="mt-0.5 size-5 text-violet-600" />
        <p className="text-sm text-muted-foreground">{t("guidance")}</p>
      </Panel>
    </PageBody>
  );
}
