import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { requirePermission } from "@/server/context";
import { pick } from "@/lib/i18n-data";
import { Link } from "@/i18n/navigation";
import { PageBody, PageHeader } from "@/components/app/page-header";
import { TemplateEditor } from "@/components/admin/template-editor";
import { MERGE_FIELD_KEYS } from "@/server/documents/merge";

export async function generateMetadata() {
  const t = await getTranslations("adminTemplates");
  return { title: t("title") };
}

export default async function TemplateEditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requirePermission("documents.templates");
  const t = await getTranslations("adminTemplates");
  const tpl = id === "new" ? null : await ctx.db.documentTemplate.findUnique({ where: { id } });
  if (id !== "new" && !tpl) notFound();
  const Back = ctx.locale === "ar" ? ArrowRight : ArrowLeft;
  const fields = MERGE_FIELD_KEYS.map((key) => ({ key, label: t(`mergeFields.${key.replace(/\./g, "_")}`) }));
  return (
    <PageBody>
      <Link href="/admin/templates" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <Back className="size-4" />
        {t("back")}
      </Link>
      <PageHeader title={tpl ? pick(ctx.locale, tpl.nameEn, tpl.nameAr) : t("new")} description={t("editHint")} />
      <TemplateEditor
        fields={fields}
        initial={{
          id: tpl?.id,
          nameEn: tpl?.nameEn ?? "",
          nameAr: tpl?.nameAr ?? "",
          descEn: tpl?.descEn ?? "",
          descAr: tpl?.descAr ?? "",
          bodyEn: tpl?.bodyEn ?? "",
          bodyAr: tpl?.bodyAr ?? "",
          signatoryEn: tpl?.signatoryEn ?? "",
          signatoryAr: tpl?.signatoryAr ?? "",
          output: tpl?.output ?? "BILINGUAL",
        }}
      />
    </PageBody>
  );
}
