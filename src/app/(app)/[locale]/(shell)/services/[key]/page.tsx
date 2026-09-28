import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ChevronLeft, Lock, ShieldAlert, Timer } from "lucide-react";
import { getCtx } from "@/server/context";
import { pick, personName } from "@/lib/i18n-data";
import { Link } from "@/i18n/navigation";
import { PageBody } from "@/components/app/page-header";
import { Panel } from "@/components/app/panel";
import { Icon } from "@/components/icon";
import { loadPickerOptions, prefillValues } from "@/server/forms/options";
import type { FormSchema } from "@/server/forms/schema";
import type { WorkflowGraph } from "@/server/workflows/graph";
import { workflowSummary } from "@/server/workflows/summary";
import { ServiceRequestClient } from "@/components/services/service-request-client";
import { canSeeStudent } from "@/server/access/student-access";
import { loadBookingSetup } from "@/server/appointments/booking-setup";

const BOOK_FIRST = ["career_guidance_session", "counselor_meeting", "parent_teacher_meeting"];

export default async function ServicePage({ params, searchParams }: { params: Promise<{ key: string }>; searchParams: Promise<{ student?: string }> }) {
  const { key } = await params;
  const sp = await searchParams;
  const ctx = await getCtx();
  const t = await getTranslations("services");
  const { db, orgId, locale } = ctx;
  const service = await db.serviceDefinition.findUnique({ where: { orgId_key: { orgId, key } }, include: { form: true, workflow: true } });
  if (!service || !service.isActive) notFound();
  if (!service.audience.some((a) => ctx.roles.includes(a))) notFound();

  const version = service.form?.publishedVersionId ? await db.formVersion.findUnique({ where: { id: service.form.publishedVersionId } }) : null;
  const schema = (version?.schema ?? null) as FormSchema | null;
  const wfVersion = service.workflow?.publishedVersionId ? await db.workflowVersion.findUnique({ where: { id: service.workflow.publishedVersionId } }) : null;
  const steps = workflowSummary((wfVersion?.graph ?? null) as WorkflowGraph | null, locale);

  // Which student is this for?
  const children = ctx.isParent ? ctx.membership.guardian?.links.map((l) => l.student) ?? [] : [];
  let studentId: string | null = null;
  if (ctx.isStudent) studentId = ctx.membership.student?.id ?? null;
  else if (ctx.isParent) studentId = sp.student && children.some((c) => c.id === sp.student) ? sp.student : children[0]?.id ?? null;
  else if (sp.student && (await canSeeStudent(ctx, sp.student))) studentId = sp.student;

  const [options, prefill, draft] = await Promise.all([
    loadPickerOptions(ctx, schema),
    prefillValues(ctx, schema, studentId),
    version ? db.formDraft.findUnique({ where: { formVersionId_membershipId_serviceId: { formVersionId: version.id, membershipId: ctx.membershipId, serviceId: service.id } } }) : null,
  ]);
  const initialValues = { ...((draft?.data as Record<string, unknown>) ?? {}), ...prefill };
  const apptType = service.appointmentTypeId ? await db.appointmentType.findUnique({ where: { id: service.appointmentTypeId } }) : null;
  const bookFirst = Boolean(apptType && BOOK_FIRST.includes(apptType.key) && (ctx.isStudent || ctx.isParent));
  const booking = bookFirst && apptType ? await loadBookingSetup(ctx, apptType.key, studentId) : null;
  const sensitive = service.sensitivity === "WELLBEING" || service.sensitivity === "SAFEGUARDING";

  return (
    <PageBody className="max-w-5xl">
      <Link href="/services" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ChevronLeft className="size-4 rtl:rotate-180" />
        {t("title")}
      </Link>
      <div className="flex items-start gap-4">
        <span className={service.sensitivity === "SAFEGUARDING" ? "grid size-12 shrink-0 place-items-center rounded-xl bg-danger text-white" : "grid size-12 shrink-0 place-items-center rounded-xl bg-brand text-brand-foreground"}>
          <Icon name={service.icon} className="size-6" />
        </span>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{pick(locale, service.nameEn, service.nameAr)}</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{pick(locale, service.descEn, service.descAr)}</p>
        </div>
      </div>
      {sensitive && (
        <div className={service.sensitivity === "SAFEGUARDING" ? "flex gap-3 rounded-xl border border-danger/25 bg-danger-soft p-4 text-sm text-danger" : "flex gap-3 rounded-xl border border-violet-200 bg-violet-50 p-4 text-sm text-violet-800"}>
          {service.sensitivity === "SAFEGUARDING" ? <ShieldAlert className="mt-0.5 size-4 shrink-0" /> : <Lock className="mt-0.5 size-4 shrink-0" />}
          <p>{service.sensitivity === "SAFEGUARDING" ? t("safeguardingNote") : t("confidentialNote")}</p>
        </div>
      )}
      <div className="grid gap-6 lg:grid-cols-[1fr_280px]">
        <Panel className="p-6">
          {ctx.isParent && children.length > 1 && (
            <div className="mb-6">
              <div className="mb-2 text-sm font-medium">{t("chooseChild")}</div>
              <div className="flex flex-wrap gap-2">
                {children.map((c) => (
                  <Link
                    key={c.id}
                    href={`/services/${key}?student=${c.id}`}
                    data-testid={`child-${c.firstNameEn.toLowerCase()}`}
                    className={c.id === studentId ? "rounded-full border border-brand bg-brand px-3 py-1.5 text-sm text-brand-foreground" : "rounded-full border px-3 py-1.5 text-sm hover:bg-muted"}
                  >
                    {personName(c, locale)} · {c.gradeLevel}
                    {c.section}
                  </Link>
                ))}
              </div>
            </div>
          )}
          <ServiceRequestClient
            key={studentId ?? "none"}
            serviceId={service.id}
            formVersionId={version?.id ?? null}
            schema={schema}
            initialValues={initialValues}
            initialStep={draft?.step ?? 0}
            options={{ students: options.students, staff: options.staff, subjects: options.subjects }}
            studentId={studentId}
            lockedFields={ctx.isStudent || ctx.isParent ? ["student"] : []}
            booking={booking}
          />
        </Panel>
        <aside className="space-y-4">
          <Panel>
            <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
              <Timer className="size-3.5" />
              {t("turnaround")}
            </div>
            <div className="mt-1 text-sm font-medium">
              {service.slaHours <= 8 ? t("sameDay") : t("withinDays", { days: Math.ceil(service.slaHours / 24) })}
            </div>
          </Panel>
          {steps.length > 0 && (
            <Panel>
              <div className="mb-3 text-xs font-medium text-muted-foreground">{t("whatHappens")}</div>
              <ol className="space-y-3">
                {steps.map((s, i) => (
                  <li key={i} className="flex gap-3 text-sm">
                    <span className="grid size-5 shrink-0 place-items-center rounded-full bg-brand-soft text-[11px] font-semibold text-brand tabular-nums">{i + 1}</span>
                    {s}
                  </li>
                ))}
              </ol>
            </Panel>
          )}
        </aside>
      </div>
    </PageBody>
  );
}
