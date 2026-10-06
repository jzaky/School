import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { Building2 } from "lucide-react";
import { getCtx } from "@/server/context";
import { formatPrefs } from "@/server/format";
import { fmtDate, fmtNumber } from "@/lib/format";
import { pick } from "@/lib/i18n-data";
import { isPlatformAdmin } from "@/server/platform/admin";
import { platformDb } from "@/server/platform/school-delete";
import { PageBody, PageHeader } from "@/components/app/page-header";
import { Panel, PanelHeader } from "@/components/app/panel";
import { Pill } from "@/components/app/badges";
import { DeleteSchoolButton } from "@/components/privacy/delete-school";

export async function generateMetadata() {
  const t = await getTranslations("platformSchools");
  return { title: t("title") };
}

export default async function PlatformSchoolsPage() {
  const ctx = await getCtx();
  if (!isPlatformAdmin(ctx.user)) notFound();
  const t = await getTranslations("platformSchools");
  const prefs = await formatPrefs(ctx);
  const db = platformDb();
  // Platform exception (owner client): lists organizations with member counts only, no personal data.
  const schools = db
    ? await db.organization.findMany({ orderBy: { createdAt: "desc" }, select: { id: true, slug: true, nameEn: true, nameAr: true, isDemo: true, createdAt: true, _count: { select: { memberships: true } } } })
    : [];

  return (
    <PageBody>
      <PageHeader title={t("title")} description={t("subtitle")} />
      <Panel padded={false}>
        <div className="p-5 pb-0">
          <PanelHeader title={t("listTitle")} description={db ? t("listHint") : t("noOwner")} icon={<Building2 className="size-4" />} />
        </div>
        {schools.length === 0 ? (
          <p className="px-5 pb-5 text-sm text-muted-foreground">{db ? t("none") : t("noOwner")}</p>
        ) : (
          <ul className="divide-y">
            {schools.map((s) => {
              const blocked = s.isDemo ? t("blockedDemo") : s.id === ctx.orgId ? t("blockedCurrent") : null;
              return (
                <li key={s.id} className="flex flex-col gap-2 px-5 py-3.5 sm:flex-row sm:items-center sm:justify-between" data-testid="platform-school">
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                      {pick(ctx.locale, s.nameEn, s.nameAr)}
                      {s.isDemo && <Pill tone="gold">{t("demo")}</Pill>}
                      {s.id === ctx.orgId && <Pill tone="info">{t("current")}</Pill>}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      <span dir="ltr">{s.slug}</span> · {t("members", { n: fmtNumber(prefs, s._count.memberships) })} · {t("created", { date: fmtDate(prefs, s.createdAt) })}
                    </p>
                  </div>
                  <DeleteSchoolButton orgId={s.id} slug={s.slug} name={pick(ctx.locale, s.nameEn, s.nameAr)} blockedReason={blocked} />
                </li>
              );
            })}
          </ul>
        )}
      </Panel>
    </PageBody>
  );
}
