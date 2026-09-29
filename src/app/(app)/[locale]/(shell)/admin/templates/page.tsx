import { getTranslations } from "next-intl/server";
import { FileSignature, Plus } from "lucide-react";
import { requirePermission } from "@/server/context";
import { formatPrefs } from "@/server/format";
import { fmtDate, fmtNumber } from "@/lib/format";
import { pick } from "@/lib/i18n-data";
import { Link } from "@/i18n/navigation";
import { PageBody, PageHeader } from "@/components/app/page-header";
import { Panel, PanelHeader } from "@/components/app/panel";
import { MessageTemplateDialog } from "@/components/onboarding/config-dialogs";
import { Mail } from "lucide-react";
import { EmptyState } from "@/components/app/empty-state";
import { Pill } from "@/components/app/badges";
import { Button } from "@/components/ui/button";

export async function generateMetadata() {
  const t = await getTranslations("adminTemplates");
  return { title: t("title") };
}

export default async function TemplatesPage() {
  const ctx = await requirePermission("documents.templates");
  const t = await getTranslations("adminTemplates");
  const prefs = await formatPrefs(ctx);
  const [templates, issued] = await Promise.all([
    ctx.db.documentTemplate.findMany({ orderBy: { nameEn: "asc" } }),
    ctx.db.document.groupBy({ by: ["templateId"], where: { orgId: ctx.orgId, source: "GENERATED" }, _count: { _all: true } }),
  ]);
  const messages = await ctx.db.messageTemplate.findMany({ orderBy: [{ key: "asc" }, { channel: "asc" }] });
  const tm = await getTranslations("onboarding.config");
  return (
    <PageBody>
      <PageHeader
        title={t("title")}
        description={t("subtitle")}
        actions={
          <Button asChild>
            <Link href="/admin/templates/new">
              <Plus className="size-4" />
              {t("new")}
            </Link>
          </Button>
        }
      />
      {templates.length === 0 ? (
        <EmptyState icon={<FileSignature className="size-5" />} title={t("empty")} />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {templates.map((tpl) => (
            <Link key={tpl.id} href={`/admin/templates/${tpl.id}`} className="group flex flex-col rounded-xl border bg-card p-5 shadow-xs transition hover:border-brand/25 hover:shadow-sm" data-testid="template-card">
              <div className="flex items-start justify-between gap-3">
                <span className="grid size-10 place-items-center rounded-lg bg-brand-soft text-brand">
                  <FileSignature className="size-5" />
                </span>
                <Pill tone="info">{t(`outputs.${tpl.output}`)}</Pill>
              </div>
              <p className="mt-4 font-semibold group-hover:text-brand">{pick(ctx.locale, tpl.nameEn, tpl.nameAr)}</p>
              <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{pick(ctx.locale, tpl.descEn, tpl.descAr)}</p>
              <div className="mt-auto flex items-center justify-between pt-4 text-xs text-muted-foreground">
                <span>{t("issued", { n: fmtNumber(prefs, issued.find((i) => i.templateId === tpl.id)?._count._all ?? 0) })}</span>
                <span>{t("updated", { date: fmtDate(prefs, tpl.updatedAt) })}</span>
              </div>
            </Link>
          ))}
        </div>
      )}
      <Panel padded={false}>
        <div className="p-5 pb-0">
          <PanelHeader title={tm("messagesTitle")} description={tm("messagesBody")} icon={<Mail className="size-4" />} />
        </div>
        {messages.length === 0 ? (
          <p className="px-5 pb-5 text-sm text-muted-foreground">{tm("noMessages")}</p>
        ) : (
          <ul className="divide-y" data-testid="message-templates">
            {messages.map((m) => {
              const label = pick(ctx.locale, m.subjectEn ?? m.bodyEn, m.subjectAr ?? m.bodyAr);
              return (
                <li key={m.id} className="flex items-center justify-between gap-3 px-5 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{label}</p>
                    <p className="truncate text-xs text-muted-foreground">{pick(ctx.locale, m.bodyEn, m.bodyAr)}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Pill>{tm(`channels.${m.channel}`)}</Pill>
                    <MessageTemplateDialog template={{ id: m.id, key: m.key, channel: m.channel, subjectEn: m.subjectEn, subjectAr: m.subjectAr, bodyEn: m.bodyEn, bodyAr: m.bodyAr }} label={label} />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Panel>
    </PageBody>
  );
}
