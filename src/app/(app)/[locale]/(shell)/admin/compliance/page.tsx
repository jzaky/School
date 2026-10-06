import { getTranslations } from "next-intl/server";
import { Archive, Bot, CheckCircle2, Clock, FileLock2, Globe2, IdCard, Scale, ShieldAlert, Timer, UserCheck, UserSearch } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { LogDsrButton, PersonLink } from "@/components/privacy/subject-tools";
import { PurposeEditor } from "@/components/privacy/purpose-editor";
import { basisKey, categoryKey } from "@/server/privacy/purposes";
import { requirePermission } from "@/server/context";
import { formatPrefs } from "@/server/format";
import { fmtDate, fmtNumber } from "@/lib/format";
import { pick } from "@/lib/i18n-data";
import { PageBody, PageHeader } from "@/components/app/page-header";
import { Panel, PanelHeader } from "@/components/app/panel";
import { StatCard } from "@/components/app/stat-card";
import { Pill } from "@/components/app/badges";
import { AiSettings, DsrStatusControl, IdentitySettings, RetentionEditor, TransferToggle } from "@/components/admin/compliance-forms";

export async function generateMetadata() {
  const t = await getTranslations("adminCompliance");
  return { title: t("title") };
}

export default async function CompliancePage() {
  const ctx = await requirePermission("compliance.manage");
  const t = await getTranslations("adminCompliance");
  const tp = await getTranslations("privacy");
  const prefs = await formatPrefs(ctx);
  const { db, orgId, org, locale } = ctx;
  const now = new Date();
  const since = new Date(now.getTime() - 30 * 86400_000);
  const [purposes, consents, dsrs, breaches, policies, transfers, aiTotal, aiBlocked] = await Promise.all([
    db.processingPurpose.findMany({ where: { orgId }, orderBy: { nameEn: "asc" } }),
    db.consentRecord.groupBy({ by: ["purposeId", "status"], where: { orgId }, _count: { _all: true } }),
    db.dataSubjectRequest.findMany({ where: { orgId }, orderBy: { receivedAt: "desc" } }),
    db.breachLog.findMany({ where: { orgId }, orderBy: { occurredAt: "desc" } }),
    db.retentionPolicy.findMany({ where: { orgId }, orderBy: { retentionDays: "desc" } }),
    db.crossBorderTransfer.findMany({ where: { orgId }, orderBy: { providerName: "asc" } }),
    db.aiInteraction.count({ where: { orgId, createdAt: { gte: since } } }),
    db.aiInteraction.count({ where: { orgId, createdAt: { gte: since }, status: "BLOCKED" } }),
  ]);
  const subjectOf = (d: { studentId: string | null; guardianId: string | null; membershipId: string | null }) =>
    d.studentId ? { kind: "student" as const, id: d.studentId } : d.guardianId ? { kind: "guardian" as const, id: d.guardianId } : d.membershipId ? { kind: "staff" as const, id: d.membershipId } : null;
  const openDsr = dsrs.filter((d) => !["COMPLETED", "REJECTED"].includes(d.status));
  const overdue = openDsr.filter((d) => d.dueAt < now).length;
  const count = (purposeId: string, status: string) => consents.find((c) => c.purposeId === purposeId && c.status === status)?._count._all ?? 0;
  const n = (v: number) => fmtNumber(prefs, v);
  const slug = (v: string) => v.toLowerCase().replace(/[^a-z]+/g, "_");
  const label = (ns: string, v: string) => (t.has(`${ns}.${slug(v)}`) ? t(`${ns}.${slug(v)}`) : v);

  const policyOptions = policies.map((p) => ({ id: p.id, nameEn: p.nameEn, nameAr: p.nameAr }));
  const policyName = (id: string) => {
    const p = policies.find((x) => x.id === id);
    return p ? pick(locale, p.nameEn, p.nameAr) : null;
  };
  const basisOptions = ["consent", "contract_with_the_family", "legal_obligation", "vital_interests", "vital_interests_and_legal_obligation", "legitimate_interest_with_opt_out", "public_interest"];
  const canExit = ctx.can("school.manage");

  const controls = [
    { key: "rls", ok: true },
    { key: "encryption", ok: true },
    { key: "auditImmutable", ok: true },
    { key: "sensitiveAi", ok: !org.aiSensitiveDataEnabled },
    { key: "parentDecision", ok: true },
    { key: "residency", ok: org.dataRegion.startsWith("me-") },
  ];

  return (
    <PageBody>
      <PageHeader
        title={t("title")}
        description={t("subtitle")}
        actions={
          <div className="flex flex-wrap gap-1.5">
            <Pill tone="info">{t("regulator", { regulator: label("regulators", org.regulator), emirate: label("emirates", org.emirate) })}</Pill>
            <Pill tone="success">{t("region", { region: org.dataRegion })}</Pill>
          </div>
        }
      />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label={t("statDsr")} value={n(openDsr.length)} hint={overdue ? t("overdueCount", { n: overdue }) : t("noneOverdue")} icon={<UserCheck className="size-5" />} tone={overdue ? "danger" : "brand"} />
        <StatCard label={t("statBreaches")} value={n(breaches.filter((b) => b.status !== "CLOSED").length)} hint={t("breachesTotal", { n: breaches.length })} icon={<ShieldAlert className="size-5" />} tone="warning" />
        <StatCard label={t("statAi")} value={n(aiTotal)} hint={t("aiBlocked", { n: aiBlocked })} icon={<Bot className="size-5" />} tone="info" />
        <StatCard label={t("statPolicies")} value={n(policies.length)} hint={t("policiesHint")} icon={<Timer className="size-5" />} tone="gold" />
      </div>

      <Panel>
        <PanelHeader title={t("controls")} description={t("controlsHint")} icon={<Scale className="size-4" />} />
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {controls.map((c) => (
            <li key={c.key} className="flex gap-3 rounded-lg border p-3">
              {c.ok ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" /> : <Clock className="mt-0.5 size-4 shrink-0 text-warning" />}
              <div>
                <p className="text-sm font-medium">{t(`control.${c.key}.title`)}</p>
                <p className="text-xs text-muted-foreground">{c.ok ? t(`control.${c.key}.ok`) : t(`control.${c.key}.warn`)}</p>
              </div>
            </li>
          ))}
        </ul>
      </Panel>

      <div className="grid gap-6 lg:grid-cols-2 [&>*]:min-w-0">
        <Panel>
          <PanelHeader title={t("aiTitle")} description={t("aiHint")} icon={<Bot className="size-4" />} />
          <AiSettings aiEnabled={org.aiEnabled} aiSensitive={org.aiSensitiveDataEnabled} />
        </Panel>
        <Panel>
          <PanelHeader title={t("identityTitle")} description={t("identityHint")} icon={<IdCard className="size-4" />} />
          <IdentitySettings emiratesIdPolicy={org.emiratesIdPolicy} passportPolicy={org.passportPolicy} crossBorderAllowed={org.crossBorderAllowed} />
        </Panel>
      </div>

      <Panel padded={false}>
        <div className="p-5 pb-0">
          <PanelHeader title={t("transfersTitle")} description={t("transfersHint")} icon={<Globe2 className="size-4" />} />
        </div>
        <ul className="divide-y">
          {transfers.map((x) => (
            <li key={x.id} className="grid gap-2 px-5 py-3.5 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_110px] sm:items-center">
              <div>
                <p className="text-sm font-medium">{x.providerName}</p>
                <p className="text-xs text-muted-foreground">
                  {t("country", { code: x.countryCode })} · {pick(locale, x.purposeEn, x.purposeAr)}
                </p>
              </div>
              <p className="text-xs text-muted-foreground">{pick(locale, x.safeguardEn, x.safeguardAr)}</p>
              <label className="flex items-center gap-2 text-xs sm:justify-end">
                <TransferToggle id={x.id} approved={x.approved} />
                {x.approved ? t("approved") : t("notApproved")}
              </label>
            </li>
          ))}
        </ul>
      </Panel>

      <Panel padded={false}>
        <div className="p-5 pb-0">
          <PanelHeader title={t("retentionTitle")} description={t("retentionHint")} icon={<Timer className="size-4" />} />
        </div>
        <ul className="divide-y">
          {policies.map((p) => (
            <li key={p.id} className="flex flex-col gap-2 px-5 py-3 sm:flex-row sm:items-center sm:justify-between" data-testid="retention-row">
              <div>
                <p className="text-sm font-medium">{pick(locale, p.nameEn, p.nameAr)}</p>
                <p className="text-xs text-muted-foreground">{p.lastRunAt ? t("lastRun", { date: fmtDate(prefs, p.lastRunAt), n: p.lastRunCount ?? 0 }) : t("neverRun")}</p>
              </div>
              <RetentionEditor id={p.id} days={p.retentionDays} action={p.action} locked={p.recordType === "case_safeguarding"} />
            </li>
          ))}
        </ul>
      </Panel>

      <Panel padded={false}>
        <div className="p-5 pb-0">
          <PanelHeader title={t("purposesTitle")} description={t("purposesHint")} icon={<FileLock2 className="size-4" />} action={<PurposeEditor policies={policyOptions} />} />
        </div>
        <ul className="divide-y">
          {purposes.map((p) => (
            <li key={p.id} className="grid gap-2 px-5 py-3.5 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_220px_auto] lg:items-center" data-testid="purpose-row">
              <div>
                <p className="text-sm font-medium">{pick(locale, p.nameEn, p.nameAr)}</p>
                <p className="text-xs text-muted-foreground">{pick(locale, p.descEn, p.descAr)}</p>
                {p.retentionPolicyId && policyName(p.retentionPolicyId) && <p className="text-xs text-muted-foreground">{tp("purposeRetentionLine", { policy: policyName(p.retentionPolicyId)! })}</p>}
              </div>
              <div className="flex flex-wrap gap-1.5 text-xs">
                <Pill>{label("basis", p.lawfulBasis)}</Pill>
                {p.dataCategories.map((c) => (
                  <Pill key={c} tone="neutral">
                    {label("category", c)}
                  </Pill>
                ))}
              </div>
              <div className="text-xs text-muted-foreground lg:text-end">
                {p.requiresConsent ? t("consentCounts", { granted: count(p.id, "GRANTED"), refused: count(p.id, "REFUSED") + count(p.id, "WITHDRAWN"), pending: count(p.id, "PENDING") }) : t("noConsentNeeded")}
              </div>
              <div className="lg:justify-self-end">
                <PurposeEditor
                  policies={policyOptions}
                  initial={{
                    id: p.id,
                    nameEn: p.nameEn,
                    nameAr: p.nameAr,
                    descEn: p.descEn,
                    descAr: p.descAr,
                    basis: basisOptions.includes(basisKey(p.lawfulBasis)) ? basisKey(p.lawfulBasis) : "consent",
                    categories: p.dataCategories.map(categoryKey),
                    requiresConsent: p.requiresConsent,
                    retentionPolicyId: p.retentionPolicyId,
                  }}
                />
              </div>
            </li>
          ))}
        </ul>
      </Panel>

      <div className="grid gap-6 lg:grid-cols-2 [&>*]:min-w-0">
        <Panel padded={false}>
          <div className="p-5 pb-0">
            <PanelHeader
              title={t("dsrTitle")}
              description={t("dsrHint")}
              icon={<UserCheck className="size-4" />}
              action={
                <div className="flex flex-wrap justify-end gap-2">
                  <LogDsrButton />
                  <Button size="sm" variant="ghost" asChild>
                    <Link href="/admin/compliance/person" data-testid="person-tools-link">
                      <UserSearch className="size-4" />
                      {tp("personTools")}
                    </Link>
                  </Button>
                </div>
              }
            />
          </div>
          <ul className="divide-y">
            {dsrs.map((d) => {
              const late = !["COMPLETED", "REJECTED"].includes(d.status) && d.dueAt < now;
              return (
                <li key={d.id} className="flex flex-col gap-2 px-5 py-3.5 sm:flex-row sm:items-center sm:justify-between" data-testid="dsr-row">
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 text-sm font-medium">
                      <span className="font-mono text-xs" dir="ltr">
                        {d.number}
                      </span>
                      {t(`dsrType.${d.type}`)}
                      {late && <Pill tone="danger">{t("overdue")}</Pill>}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {d.subjectName} · {t("due", { date: fmtDate(prefs, d.dueAt) })}
                    </p>
                    {d.resolution && <p className="truncate text-xs text-muted-foreground">{d.resolution}</p>}
                    {subjectOf(d) && (
                      <PersonLink kind={subjectOf(d)!.kind} id={subjectOf(d)!.id}>
                        {tp("openPerson")}
                      </PersonLink>
                    )}
                  </div>
                  <DsrStatusControl id={d.id} status={d.status} />
                </li>
              );
            })}
          </ul>
        </Panel>
        <Panel padded={false}>
          <div className="p-5 pb-0">
            <PanelHeader title={t("breachTitle")} description={t("breachHint")} icon={<ShieldAlert className="size-4" />} />
          </div>
          {breaches.length === 0 ? (
            <p className="px-5 pb-5 text-sm text-muted-foreground">{t("noBreaches")}</p>
          ) : (
            <ul className="divide-y">
              {breaches.map((b) => (
                <li key={b.id} className="space-y-1 px-5 py-3.5">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                    {pick(locale, b.titleEn, b.titleAr)}
                    <Pill tone={b.severity === "LOW" ? "neutral" : b.severity === "MEDIUM" ? "warning" : "danger"}>{t(`severity.${b.severity}`)}</Pill>
                    <Pill tone={b.status === "CLOSED" ? "success" : "warning"}>{t(`breachStatus.${b.status}`)}</Pill>
                  </p>
                  <p className="text-xs text-muted-foreground">{pick(locale, b.descriptionEn, b.descriptionAr ?? b.descriptionEn)}</p>
                  <p className="text-xs text-muted-foreground">{t("breachDates", { occurred: fmtDate(prefs, b.occurredAt), affected: b.affectedCount })}</p>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      {canExit && (
        <Panel>
          <PanelHeader
            title={tp("exitTitle")}
            description={tp("exitHint")}
            icon={<Archive className="size-4" />}
            action={
              <Button size="sm" variant="outline" asChild>
                <Link href="/admin/compliance/exit" data-testid="exit-link">
                  {tp("exitOpen")}
                </Link>
              </Button>
            }
          />
        </Panel>
      )}
    </PageBody>
  );
}
