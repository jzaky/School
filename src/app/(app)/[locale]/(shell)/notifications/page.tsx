import { getTranslations } from "next-intl/server";
import { BellOff, Settings2 } from "lucide-react";
import { getCtx } from "@/server/context";
import { formatPrefs } from "@/server/format";
import { fmtDateTime, fmtRelative } from "@/lib/format";
import { pick } from "@/lib/i18n-data";
import { Link } from "@/i18n/navigation";
import { PageBody, PageHeader } from "@/components/app/page-header";
import { FilterBar } from "@/components/app/filter-bar";
import { EmptyState } from "@/components/app/empty-state";
import { Button } from "@/components/ui/button";
import { MarkAllRead, NotificationList } from "@/components/notifications/notification-list";

export async function generateMetadata() {
  const t = await getTranslations("notifications");
  return { title: t("title") };
}

export default async function NotificationsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const sp = await searchParams;
  const ctx = await getCtx();
  const t = await getTranslations("notifications");
  const prefs = await formatPrefs(ctx);
  const base = { orgId: ctx.orgId, recipientId: ctx.membershipId };
  const unreadOnly = sp.tab === "unread";
  const [rows, unread, total] = await Promise.all([
    ctx.db.notification.findMany({ where: { ...base, ...(unreadOnly ? { readAt: null } : {}) }, orderBy: { createdAt: "desc" }, take: 100 }),
    ctx.db.notification.count({ where: { ...base, readAt: null } }),
    ctx.db.notification.count({ where: base }),
  ]);
  const items = rows.map((n) => ({
    id: n.id,
    title: pick(ctx.locale, n.titleEn, n.titleAr),
    body: pick(ctx.locale, n.bodyEn, n.bodyAr),
    href: n.href,
    urgent: n.urgent,
    read: Boolean(n.readAt),
    when: `${fmtRelative(prefs, n.createdAt)} · ${fmtDateTime(prefs, n.createdAt)}`,
  }));
  return (
    <PageBody className="max-w-4xl">
      <PageHeader
        title={t("title")}
        description={t("subtitle")}
        actions={
          <>
            <Button variant="ghost" asChild>
              <Link href="/settings#notifications">
                <Settings2 className="size-4" />
                {t("preferences")}
              </Link>
            </Button>
            <MarkAllRead disabled={unread === 0} />
          </>
        }
      />
      <FilterBar tabs={[{ value: "all", label: t("tabAll"), count: total }, { value: "unread", label: t("tabUnread"), count: unread }]} />
      {items.length === 0 ? <EmptyState icon={<BellOff className="size-5" />} title={t("empty")} body={t("emptyBody")} /> : <NotificationList items={items} />}
    </PageBody>
  );
}
