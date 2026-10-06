import { getTranslations } from "next-intl/server";
import { Building2, KeyRound } from "lucide-react";
import { getGroupCtx, pickGroup } from "@/server/groups/context";
import { listGroupSchools } from "@/server/groups/dashboard";
import { listGroupInvites } from "@/server/groups/invites";
import { groupInviteState } from "@/server/groups/codes";
import { pick } from "@/lib/i18n-data";
import { PageBody, PageHeader } from "@/components/app/page-header";
import { Panel, PanelHeader } from "@/components/app/panel";
import { EmptyState } from "@/components/app/empty-state";
import { Pill } from "@/components/app/badges";
import { GroupSwitcher } from "@/components/groups/group-bits";
import { InvitePanel, type InviteRow } from "@/components/groups/invite-panel";

export async function generateMetadata() {
  const t = await getTranslations("groups");
  return { title: t("schoolsTitle") };
}

export default async function GroupSchoolsPage({ searchParams }: { searchParams: Promise<{ g?: string }> }) {
  const sp = await searchParams;
  const ctx = await getGroupCtx();
  const t = await getTranslations("groups");
  const current = pickGroup(ctx, sp.g);
  if (!current) {
    return (
      <PageBody>
        <EmptyState icon={<Building2 className="size-5" />} title={t("noGroupTitle")} body={t("noGroupBody")} />
      </PageBody>
    );
  }
  const { locale } = ctx;
  const [schools, invites] = await Promise.all([listGroupSchools(ctx.userId, current.groupId), listGroupInvites(ctx.userId, current.groupId)]);
  const df = new Intl.DateTimeFormat(locale === "ar" ? "ar-AE-u-nu-latn" : "en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Dubai" });
  const now = new Date();
  const schoolById = new Map(schools.map((s) => [s.id, pick(locale, s.nameEn, s.nameAr)]));
  const rows: InviteRow[] = invites.map((i) => ({
    id: i.id,
    hint: i.codeHint,
    state: groupInviteState(i, now),
    created: df.format(i.createdAt),
    expires: df.format(i.expiresAt),
    usedBy: i.usedByOrgId ? (schoolById.get(i.usedByOrgId) ?? null) : null,
  }));
  const isAdmin = current.role === "ADMIN";
  return (
    <PageBody>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <PageHeader eyebrow={pick(locale, current.group.nameEn, current.group.nameAr)} title={t("schoolsTitle")} description={t("schoolsSubtitle")} />
        <GroupSwitcher groups={ctx.roles.map((r) => ({ id: r.groupId, name: pick(locale, r.group.nameEn, r.group.nameAr) }))} current={current.groupId} />
      </div>
      <div className="grid gap-6 lg:grid-cols-5">
        <Panel className="lg:col-span-3">
          <PanelHeader title={t("memberSchools")} description={t("memberSchoolsHint")} icon={<Building2 className="size-4" />} />
          {schools.length === 0 ? (
            <p className="rounded-lg border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">{t("noSchoolsBody")}</p>
          ) : (
            <ul className="divide-y rounded-lg border" role="list" data-testid="group-member-schools">
              {schools.map((s) => (
                <li key={s.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
                  <div className="min-w-0 flex-1">
                    <div className="font-medium">{pick(locale, s.nameEn, s.nameAr)}</div>
                    <div className="text-xs text-muted-foreground">{t("joinedOn", { date: df.format(s.joinedAt) })}</div>
                  </div>
                  <Pill tone={s.via === "invite" ? "info" : "neutral"}>{t(`via.${s.via === "invite" ? "invite" : "platform"}`)}</Pill>
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <Panel className="lg:col-span-2">
          <PanelHeader title={t("invites.title")} description={t("invites.hint")} icon={<KeyRound className="size-4" />} />
          <InvitePanel groupId={current.groupId} invites={rows} isAdmin={isAdmin} />
        </Panel>
      </div>
    </PageBody>
  );
}
