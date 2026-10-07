export const dynamic = "force-dynamic";

import { getTranslations } from "next-intl/server";
import { getGroupCtx } from "@/server/groups/context";
import { pick } from "@/lib/i18n-data";
import { GroupHeader, type GroupNavItem } from "@/components/groups/group-header";

export async function generateMetadata() {
  const t = await getTranslations("groups");
  return { title: t("areaTitle") };
}

/** The school group area: separate from any one school's shell. */
export default async function GroupLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getGroupCtx();
  const t = await getTranslations("groups");
  const isAdmin = ctx.roles.some((r) => r.role === "ADMIN");
  const items: GroupNavItem[] = [];
  if (ctx.roles.length) items.push({ key: "dashboard", href: "/group" }, { key: "schools", href: "/group/schools" });
  if (isAdmin) items.push({ key: "templates", href: "/group/templates" });
  if (ctx.platformAdmin) items.push({ key: "platform", href: "/group/platform" });
  const first = ctx.roles[0];
  const roleLabel = first ? pick(ctx.locale, first.titleEn, first.titleAr) || t(`role.${first.role}`) : ctx.platformAdmin ? t("role.PLATFORM") : "";
  return (
    <div className="min-h-dvh bg-background">
      <GroupHeader items={items} userName={pick(ctx.locale, ctx.user.nameEn, ctx.user.nameAr)} roleLabel={roleLabel} backToSchool={!!ctx.activeOrgId} />
      <main>{children}</main>
    </div>
  );
}
