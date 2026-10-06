import { getTranslations } from "next-intl/server";
import { Copy, History, Lock } from "lucide-react";
import { identityDb } from "@/lib/tenant-db";
import { getGroupCtx, pickGroup } from "@/server/groups/context";
import { listGroupSchools } from "@/server/groups/dashboard";
import { listPushes, type PushResult } from "@/server/groups/push";
import { pick } from "@/lib/i18n-data";
import { PageBody, PageHeader } from "@/components/app/page-header";
import { Panel, PanelHeader } from "@/components/app/panel";
import { EmptyState } from "@/components/app/empty-state";
import { Pill } from "@/components/app/badges";
import { GroupSwitcher } from "@/components/groups/group-bits";
import { PushForm } from "@/components/groups/push-form";

export async function generateMetadata() {
  const t = await getTranslations("groups");
  return { title: t("templatesTitle") };
}

export default async function GroupTemplatesPage({ searchParams }: { searchParams: Promise<{ g?: string }> }) {
  const sp = await searchParams;
  const ctx = await getGroupCtx();
  const t = await getTranslations("groups");
  const current = pickGroup(ctx, sp.g);
  if (!current || current.role !== "ADMIN") {
    return (
      <PageBody>
        <EmptyState icon={<Lock className="size-5" />} title={t("adminOnlyTitle")} body={t("adminOnlyBody")} />
      </PageBody>
    );
  }
  const { locale } = ctx;
  const [schools, pushes] = await Promise.all([listGroupSchools(ctx.userId, current.groupId), listPushes(ctx.userId, current.groupId)]);
  const people = await identityDb.user.findMany({ where: { id: { in: [...new Set(pushes.map((p) => p.pushedById))] } }, select: { id: true, nameEn: true, nameAr: true } });
  const df = new Intl.DateTimeFormat(locale === "ar" ? "ar-AE-u-nu-latn" : "en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Dubai" });
  const name = (id: string) => {
    const s = schools.find((x) => x.id === id);
    return s ? pick(locale, s.nameEn, s.nameAr) : t("formerSchool");
  };
  const options = schools.map((s) => ({ id: s.id, name: pick(locale, s.nameEn, s.nameAr) }));
  return (
    <PageBody>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <PageHeader eyebrow={pick(locale, current.group.nameEn, current.group.nameAr)} title={t("templatesTitle")} description={t("templatesSubtitle")} />
        <GroupSwitcher groups={ctx.roles.map((r) => ({ id: r.groupId, name: pick(locale, r.group.nameEn, r.group.nameAr) }))} current={current.groupId} />
      </div>
      <div className="grid gap-6 lg:grid-cols-5">
        <Panel className="lg:col-span-3">
          <PanelHeader title={t("push.title")} description={t("push.hint")} icon={<Copy className="size-4" />} />
          {schools.length < 2 ? <p className="text-sm text-muted-foreground">{t("push.needTwoSchools")}</p> : <PushForm groupId={current.groupId} schools={options} defaultSource={options[0].id} />}
        </Panel>
        <Panel className="lg:col-span-2">
          <PanelHeader title={t("history.title")} description={t("history.hint")} icon={<History className="size-4" />} />
          {pushes.length === 0 ? (
            <p className="rounded-lg border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">{t("history.empty")}</p>
          ) : (
            <ul className="space-y-3" role="list" data-testid="push-history">
              {pushes.map((p) => {
                const by = people.find((u) => u.id === p.pushedById);
                const results = (Array.isArray(p.results) ? p.results : []) as unknown as PushResult[];
                return (
                  <li key={p.id} className="rounded-lg border p-3 text-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{pick(locale, p.labelEn, p.labelAr)}</span>
                      <Pill tone="neutral">{t(`push.kinds.${p.kind}`)}</Pill>
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {t("history.line", { source: name(p.sourceOrgId), who: by ? pick(locale, by.nameEn, by.nameAr) : t("history.someone"), when: df.format(p.createdAt) })}
                    </div>
                    <ul className="mt-2 flex flex-wrap gap-1.5" role="list">
                      {p.targetOrgIds.map((id) => {
                        const r = results.find((x) => x.orgId === id);
                        return (
                          <li key={id}>
                            <Pill tone={r?.status === "failed" ? "danger" : "success"}>
                              {name(id)}: {t(`push.status.${r?.status ?? "failed"}`)}
                            </Pill>
                          </li>
                        );
                      })}
                    </ul>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>
      </div>
    </PageBody>
  );
}
