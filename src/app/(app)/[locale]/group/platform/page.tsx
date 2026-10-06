import { getTranslations } from "next-intl/server";
import { Lock, Plus } from "lucide-react";
import { getGroupCtx } from "@/server/groups/context";
import { listAllGroups, listUngroupedSchools } from "@/server/groups/platform";
import { catalogWritable } from "@/server/platform/catalog-db";
import { pick } from "@/lib/i18n-data";
import { PageBody, PageHeader } from "@/components/app/page-header";
import { Panel, PanelHeader } from "@/components/app/panel";
import { EmptyState } from "@/components/app/empty-state";
import { CreateGroupForm, GroupAdminCard } from "@/components/groups/platform-admin";

export async function generateMetadata() {
  const t = await getTranslations("groups");
  return { title: t("platform.title") };
}

/** Platform admin: create groups, assign schools, give people group roles. */
export default async function GroupPlatformPage() {
  const ctx = await getGroupCtx();
  const t = await getTranslations("groups");
  if (!ctx.platformAdmin) {
    return (
      <PageBody>
        <EmptyState icon={<Lock className="size-5" />} title={t("platform.onlyTitle")} body={t("platform.onlyBody")} />
      </PageBody>
    );
  }
  if (!catalogWritable()) {
    return (
      <PageBody>
        <EmptyState icon={<Lock className="size-5" />} title={t("platform.unavailableTitle")} body={t("platform.unavailableBody")} />
      </PageBody>
    );
  }
  const { locale } = ctx;
  const [groups, ungrouped] = await Promise.all([listAllGroups(), listUngroupedSchools()]);
  const ungroupedOptions = ungrouped.map((o) => ({ id: o.id, name: `${pick(locale, o.nameEn, o.nameAr)} (${o.slug})` }));
  return (
    <PageBody>
      <PageHeader title={t("platform.title")} description={t("platform.subtitle")} />
      <Panel>
        <PanelHeader title={t("platform.createTitle")} description={t("platform.createHint")} icon={<Plus className="size-4" />} />
        <CreateGroupForm />
      </Panel>
      {groups.length === 0 ? (
        <EmptyState title={t("platform.noGroups")} body={t("platform.noGroupsBody")} />
      ) : (
        <div className="space-y-4">
          {groups.map((g) => (
            <GroupAdminCard
              key={g.id}
              ungrouped={ungroupedOptions}
              group={{
                id: g.id,
                nameEn: g.nameEn,
                nameAr: g.nameAr,
                displayName: pick(locale, g.nameEn, g.nameAr),
                hasLogo: !!g.logoUrl,
                version: g.updatedAt.getTime(),
                schools: g.schools.map((s) => ({ orgId: s.orgId, name: pick(locale, s.org.nameEn, s.org.nameAr), via: s.via })),
                members: g.members.map((m) => ({ id: m.id, role: m.role, email: m.user?.email ?? "", name: m.user ? pick(locale, m.user.nameEn, m.user.nameAr) : "" })),
              }}
            />
          ))}
        </div>
      )}
    </PageBody>
  );
}
