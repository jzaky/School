import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Inbox, UserCheck } from "lucide-react";
import { getCtx } from "@/server/context";
import { formatPrefs } from "@/server/format";
import { fmtDate, fmtDateTime } from "@/lib/format";
import { personName, pick, userName } from "@/lib/i18n-data";
import { Link } from "@/i18n/navigation";
import { audienceOfRole } from "@/server/access/permission-catalog";
import { claimsOf, matchHints, studentsForClaims } from "@/server/access/join-requests";
import { PageBody, PageHeader } from "@/components/app/page-header";
import { Panel } from "@/components/app/panel";
import { Pill } from "@/components/app/badges";
import { EmptyState } from "@/components/app/empty-state";
import { AccessTabs } from "@/components/access/access-tabs";
import { JoinRequestDecision, type Candidate } from "@/components/access/join-request-forms";

export async function generateMetadata() {
  const t = await getTranslations("joinRequests");
  return { title: t("title") };
}

export default async function JoinRequestsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const sp = await searchParams;
  const ctx = await getCtx();
  if (!ctx.can("people.manage") && !ctx.can("people.invite")) notFound();
  const t = await getTranslations("joinRequests");
  const prefs = await formatPrefs(ctx);
  const { db, locale } = ctx;
  const tab = sp.tab === "decided" ? "decided" : "pending";

  const [pendingCount, requests] = await Promise.all([
    db.joinRequest.count({ where: { status: "PENDING" } }),
    db.joinRequest.findMany({ where: tab === "pending" ? { status: "PENDING" } : { status: { not: "PENDING" } }, orderBy: { createdAt: tab === "pending" ? "asc" : "desc" }, take: tab === "pending" ? 100 : 50 }),
  ]);
  const members = await db.membership.findMany({ where: { id: { in: [...new Set([...requests.map((r) => r.membershipId), ...requests.map((r) => r.decidedById).filter((x): x is string => !!x)])] } }, include: { user: { select: { nameEn: true, nameAr: true, email: true } } } });
  const memberOf = (id: string | null) => members.find((m) => m.id === id);

  return (
    <PageBody>
      <PageHeader
        title={t("title")}
        description={t("subtitle")}
        actions={
          <Link href="/admin/invitations?tab=signin" className="text-sm font-medium text-brand hover:underline">
            {t("joinSettings")}
          </Link>
        }
      />
      <AccessTabs
        current={tab}
        label={t("title")}
        tabs={[
          { value: "pending", label: t("tabPending"), href: "/admin/join-requests", count: pendingCount },
          { value: "decided", label: t("tabDecided"), href: "/admin/join-requests?tab=decided" },
        ]}
      />
      {requests.length === 0 ? (
        <EmptyState icon={<Inbox className="size-5" />} title={tab === "pending" ? t("emptyPending") : t("emptyDecided")} body={tab === "pending" ? t("emptyPendingBody") : t("emptyDecidedBody")} />
      ) : tab === "pending" ? (
        await pendingList()
      ) : (
        <Panel padded={false}>
          <ul className="divide-y">
            {requests.map((r) => {
              const m = memberOf(r.membershipId);
              const by = memberOf(r.decidedById);
              return (
                <li key={r.id} className="flex flex-wrap items-start justify-between gap-2 px-5 py-3" data-testid="jr-decided">
                  <div className="min-w-0">
                    <div className="text-sm font-medium">{m ? userName(m.user, locale) : t("unknownPerson")}</div>
                    <div className="text-xs text-muted-foreground">
                      {t(`kind.${r.kind}`)} · {r.decidedAt ? t("decidedBy", { name: by ? userName(by.user, locale) : t("automatic"), date: fmtDate(prefs, r.decidedAt) }) : ""}
                    </div>
                    {r.decisionNote && <div className="mt-1 text-xs">{r.decisionNote === "invite" ? t("closedByInvite") : r.decisionNote}</div>}
                  </div>
                  <Pill tone={r.status === "APPROVED" ? "success" : "danger"} dot>
                    {t(`status.${r.status}`)}
                  </Pill>
                </li>
              );
            })}
          </ul>
        </Panel>
      )}
    </PageBody>
  );

  async function pendingList() {
    const allClaims = requests.map((r) => ({ r, claims: claimsOf(r.claimedStudents) }));
    const candidates = await studentsForClaims(db as never, allClaims.flatMap((x) => x.claims));
    const [roles, students] = await Promise.all([
      db.role.findMany({ select: { key: true, nameEn: true, nameAr: true } }),
      db.student.findMany({ where: { status: "ACTIVE" }, select: { id: true, studentNo: true, gradeLevel: true, section: true, firstNameEn: true, lastNameEn: true, firstNameAr: true, lastNameAr: true }, orderBy: [{ gradeLevel: "asc" }, { lastNameEn: "asc" }], take: 3000 }),
    ]);
    const staffRoles = roles.filter((r) => audienceOfRole(r.key) === "staff").map((r) => ({ key: r.key, label: pick(locale, r.nameEn, r.nameAr) }));
    const studentOptions = students.map((s) => ({ value: s.id, label: personName(s, locale), hint: `${s.studentNo} · ${t("gradeSection", { grade: s.gradeLevel, section: s.section ?? "" })}`, keywords: `${s.firstNameEn} ${s.lastNameEn} ${s.firstNameAr} ${s.lastNameAr} ${s.studentNo}` }));
    return (
      <div className="space-y-4">
        {allClaims.map(({ r, claims }) => {
          const m = memberOf(r.membershipId);
          const hints = new Map<string, Candidate>();
          for (const c of claims) {
            for (const h of matchHints(c, candidates)) {
              const s = candidates.find((x) => x.id === h.studentId)!;
              const prev = hints.get(s.id);
              if (!prev || (!prev.exact && h.exact)) {
                hints.set(s.id, {
                  id: s.id,
                  label: personName(s, locale),
                  detail: `${s.studentNo} · ${t("gradeSection", { grade: s.gradeLevel, section: s.section ?? "" })}${s.dateOfBirth ? ` · ${fmtDate(prefs, s.dateOfBirth)}` : ""}`,
                  reasons: h.reasons,
                  exact: h.exact,
                  taken: r.kind === "STUDENT" && !!s.membershipId,
                });
              }
            }
          }
          const list = [...hints.values()];
          return (
            <Panel key={r.id} className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
              <div className="min-w-0 space-y-3" data-testid="join-request">
                <div className="flex flex-wrap items-center gap-2">
                  <UserCheck className="size-4 text-muted-foreground" />
                  <span className="text-base font-semibold">{m ? userName(m.user, locale) : t("unknownPerson")}</span>
                  <Pill tone="brand">{t(`kind.${r.kind}`)}</Pill>
                </div>
                <div className="text-xs text-muted-foreground">
                  <span dir="ltr">{m?.user.email}</span> · {t("requested", { date: fmtDateTime(prefs, r.createdAt) })}
                </div>
                {r.note && <p className="rounded-lg bg-muted/40 px-3 py-2 text-sm">{r.note}</p>}
                {claims.length > 0 && (
                  <div>
                    <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t("theyEntered")}</div>
                    <ul className="space-y-1">
                      {claims.map((c, i) => (
                        <li key={i} className="rounded-lg border px-3 py-2 text-sm" data-testid="jr-claim">
                          {c.studentNo ? t("claimByNumber", { number: c.studentNo, dob: c.dateOfBirth ?? "" }) : t("claimByName", { name: c.fullName ?? "", grade: c.grade ?? 0 })}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
              <JoinRequestDecision
                requestId={r.id}
                kind={r.kind}
                candidates={list}
                preselected={list.filter((c) => c.exact && !c.taken).map((c) => c.id)}
                roles={staffRoles}
                students={studentOptions}
              />
            </Panel>
          );
        })}
      </div>
    );
  }
}
