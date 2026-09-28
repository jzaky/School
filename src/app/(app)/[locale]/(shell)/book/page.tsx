import { getTranslations } from "next-intl/server";
import { getCtx } from "@/server/context";
import { pick, personName } from "@/lib/i18n-data";
import { PageBody, PageHeader } from "@/components/app/page-header";
import { Panel } from "@/components/app/panel";
import { loadBookingSetup } from "@/server/appointments/booking-setup";
import { loadPickerOptions } from "@/server/forms/options";
import { canSeeStudent } from "@/server/access/student-access";
import { canViewCase } from "@/server/access/case-access";
import { StaffBooking } from "@/components/meetings/staff-booking";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";

export default async function BookPage({ searchParams }: { searchParams: Promise<{ type?: string; student?: string; case?: string }> }) {
  const sp = await searchParams;
  const ctx = await getCtx();
  const t = await getTranslations("meetings");
  const { db, orgId, locale } = ctx;
  const types = await db.appointmentType.findMany({ where: { orgId, isActive: true, audience: { hasSome: ctx.isStaff ? ["staff", ...ctx.roles] : ctx.roles } }, orderBy: { nameEn: "asc" } });
  const selected = types.find((x) => x.key === sp.type) ?? types[0];
  let studentId = sp.student && (await canSeeStudent(ctx, sp.student)) ? sp.student : null;
  const theCase = sp.case ? await db.case.findUnique({ where: { id: sp.case } }) : null;
  const caseOk = theCase ? await canViewCase(ctx, theCase, { audit: false }) : false;
  if (theCase && caseOk && !studentId) studentId = theCase.studentId;
  const setup = selected ? await loadBookingSetup(ctx, selected.key, studentId) : null;
  const options = await loadPickerOptions(ctx, null);
  const guardians = studentId ? await db.guardianLink.findMany({ where: { studentId }, include: { guardian: true }, orderBy: { isPrimary: "desc" } }) : [];
  const sensitive = theCase && (theCase.sensitivity === "WELLBEING" || theCase.sensitivity === "SAFEGUARDING");
  return (
    <PageBody className="max-w-4xl">
      <PageHeader title={t("bookTitle")} description={theCase && caseOk ? t("forCase", { number: theCase.number }) : t("bookSubtitle")} />
      <div className="flex flex-wrap gap-2">
        {types.map((x) => (
          <Link
            key={x.id}
            href={`/book?type=${x.key}${studentId ? `&student=${studentId}` : ""}${theCase && caseOk ? `&case=${theCase.id}` : ""}`}
            className={cn("rounded-full border px-3 py-1.5 text-sm transition", x.id === selected?.id ? "border-brand bg-brand text-brand-foreground" : "bg-card hover:bg-muted")}
          >
            {pick(locale, x.nameEn, x.nameAr)}
          </Link>
        ))}
      </div>
      <Panel className="p-6">
        {setup ? (
          <StaffBooking
            key={`${setup.type.id}-${studentId}`}
            setup={setup}
            studentId={studentId}
            students={ctx.isStaff ? options.students : []}
            caseId={theCase && caseOk ? theCase.id : null}
            guardians={guardians.filter((g) => g.guardian.membershipId).map((g) => ({ id: g.guardianId, name: `${personName(g.guardian, locale)} (${pick(locale, g.relationshipEn, g.relationshipAr)})` }))}
            defaultInvite={!sensitive}
            sensitive={Boolean(sensitive)}
          />
        ) : (
          <p className="text-sm text-muted-foreground">{t("noTypes")}</p>
        )}
      </Panel>
    </PageBody>
  );
}
