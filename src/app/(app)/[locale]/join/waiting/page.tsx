import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { BellRing, Clock, XCircle } from "lucide-react";
import { auth } from "@/auth";
import { pick } from "@/lib/i18n-data";
import { joinStatusForUser } from "@/server/access/join";
import { JoinShell } from "@/components/access/join-shell";
import { WaitingActions } from "@/components/access/waiting-actions";
import { Button } from "@/components/ui/button";

export async function generateMetadata() {
  const t = await getTranslations("join");
  return { title: t("waitingTitle") };
}

export default async function WaitingPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const t = await getTranslations("join");
  const { waiting, hasActive } = await joinStatusForUser(session.user.id);
  if (waiting.length === 0 && hasActive) redirect(`/${locale}/home`);
  const fmt = new Intl.DateTimeFormat(locale === "ar" ? "ar-AE-u-nu-latn" : "en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Dubai" });
  return (
    <JoinShell>
      <div className="space-y-4" data-testid="waiting-screen">
        {waiting.length === 0 && (
          <div className="rounded-2xl border bg-card p-6 text-center shadow-sm">
            <h1 className="text-lg font-semibold">{t("nothingPending")}</h1>
            <p className="mt-1 text-sm text-muted-foreground">{t("nothingPendingBody")}</p>
            <Button asChild className="mt-4">
              <Link href={`/${locale}/join`}>{t("haveCode")}</Link>
            </Button>
          </div>
        )}
        {waiting.map((w) => (
          <div key={w.orgId} className="rounded-2xl border bg-card p-6 shadow-sm">
            <div className={w.status === "PENDING" ? "mb-4 grid size-12 place-items-center rounded-full bg-warning-soft text-[oklch(0.55_0.14_65)]" : "mb-4 grid size-12 place-items-center rounded-full bg-danger-soft text-danger"}>
              {w.status === "PENDING" ? <Clock className="size-6" /> : <XCircle className="size-6" />}
            </div>
            <h1 className="text-xl font-semibold tracking-tight">{w.status === "PENDING" ? t("waitingHeadline") : t("rejectedHeadline")}</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {w.status === "PENDING"
                ? t(w.kind === "STAFF" ? "waitingBodyStaff" : "waitingBody", { school: pick(locale, w.schoolEn, w.schoolAr), count: w.childCount })
                : t("rejectedBody", { school: pick(locale, w.schoolEn, w.schoolAr) })}
            </p>
            {w.requestedAt && <p className="mt-3 text-xs text-muted-foreground">{t("requestedOn", { date: fmt.format(w.requestedAt) })}</p>}
            {w.decisionNote && <p className="mt-3 rounded-lg bg-muted/50 px-3 py-2 text-sm">{w.decisionNote}</p>}
          </div>
        ))}
        {waiting.some((w) => w.status === "PENDING") && (
          <div className="flex items-start gap-3 rounded-2xl border bg-card p-5 shadow-sm">
            <BellRing className="mt-0.5 size-5 shrink-0 text-brand" />
            <div>
              <div className="text-sm font-semibold">{t("whatNextTitle")}</div>
              <p className="mt-0.5 text-sm text-muted-foreground">{t("whatNextBody")}</p>
            </div>
          </div>
        )}
        <WaitingActions homeHref={`/${locale}/home`} hasActive={hasActive} />
      </div>
    </JoinShell>
  );
}
