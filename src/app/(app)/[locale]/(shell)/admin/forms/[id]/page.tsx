import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getCtx } from "@/server/context";
import { formatPrefs } from "@/server/format";
import { fmtDateTime } from "@/lib/format";
import { pick, userName } from "@/lib/i18n-data";
import { loadPickerOptions } from "@/server/forms/options";
import { blankSchema } from "@/server/forms/builder";
import type { FormSchema } from "@/server/forms/schema";
import { FormBuilder } from "@/components/admin/form-builder";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const t = await getTranslations("adminForms");
  if (id === "new") return { title: t("newForm") };
  const ctx = await getCtx();
  const form = ctx.can("forms.manage") ? await ctx.db.form.findUnique({ where: { id } }) : null;
  return { title: form ? pick(ctx.locale, form.nameEn, form.nameAr) : t("title") };
}

// Any field type can be added in the builder, so the preview loads every picker list.
const ALL_PICKERS: FormSchema = {
  version: 1,
  steps: [{ id: "p", title: { en: "", ar: "" }, sections: [{ id: "p", fields: [{ id: "p", type: "staff_picker", label: { en: "", ar: "" } }] }] }],
};

export default async function FormBuilderPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ai?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const ctx = await getCtx();
  if (!ctx.can("forms.manage")) notFound();
  const { db, locale } = ctx;
  const prefs = await formatPrefs(ctx);
  const isNew = id === "new";
  const form = isNew
    ? null
    : await db.form.findUnique({
        where: { id },
        include: {
          versions: { select: { id: true, version: true, schema: true, publishedAt: true, publishedById: true, _count: { select: { submissions: true } } }, orderBy: { version: "desc" } },
          services: { select: { id: true, key: true, nameEn: true, nameAr: true, isActive: true } },
        },
      });
  if (!isNew && !form) notFound();

  const published = form?.versions.find((v) => v.id === form.publishedVersionId) ?? null;
  const schema = ((form?.draftSchema ?? published?.schema ?? null) as FormSchema | null) ?? blankSchema();
  const changed = Boolean(published && form?.draftSchema && JSON.stringify(form.draftSchema) !== JSON.stringify(published.schema));
  const publisherIds = (form?.versions.map((v) => v.publishedById).filter(Boolean) ?? []) as string[];
  const publishers = publisherIds.length ? await db.membership.findMany({ where: { id: { in: publisherIds } }, include: { user: true } }) : [];
  const options = await loadPickerOptions(ctx, ALL_PICKERS);

  return (
    <FormBuilder
      key={form?.id ?? "new"}
      formId={form?.id ?? null}
      initialMeta={{
        nameEn: form?.nameEn ?? "",
        nameAr: form?.nameAr ?? "",
        descEn: form?.descEn ?? "",
        descAr: form?.descAr ?? "",
        categoryEn: form?.categoryEn ?? "",
        categoryAr: form?.categoryAr ?? "",
      }}
      initialSchema={schema}
      publishedVersion={published?.version ?? null}
      hasUnpublishedChanges={changed}
      versions={(form?.versions ?? []).map((v) => {
        const by = publishers.find((m) => m.id === v.publishedById);
        return { id: v.id, version: v.version, when: fmtDateTime(prefs, v.publishedAt), by: by ? userName(by.user, locale) : "", submissions: v._count.submissions, current: v.id === form?.publishedVersionId };
      })}
      services={(form?.services ?? []).map((s) => ({ id: s.id, key: s.key, name: pick(locale, s.nameEn, s.nameAr), active: s.isActive }))}
      options={{ students: options.students, staff: options.staff, subjects: options.subjects }}
      openAi={isNew && sp.ai === "1"}
    />
  );
}
