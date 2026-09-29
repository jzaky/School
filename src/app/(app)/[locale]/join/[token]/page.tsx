import { headers } from "next/headers";
import { getTranslations } from "next-intl/server";
import { LinkIcon } from "lucide-react";
import { auth, enabledOAuthProviders } from "@/auth";
import { identityDb } from "@/lib/tenant-db";
import { pick } from "@/lib/i18n-data";
import { previewInvite, JoinError, type InvitePreview } from "@/server/access/join";
import { clientIp } from "@/server/access/rate-limit";
import { JoinUnavailableError } from "@/server/platform/join-lookup";
import { JoinShell } from "@/components/access/join-shell";
import { InviteJoin } from "@/components/access/join-flows";
import { Button } from "@/components/ui/button";
import Link from "next/link";

export async function generateMetadata() {
  const t = await getTranslations("join");
  return { title: t("inviteMetaTitle") };
}

export default async function JoinInvitePage({ params }: { params: Promise<{ locale: string; token: string }> }) {
  const { locale, token } = await params;
  const t = await getTranslations("join");
  let preview: InvitePreview | { ok: false; reason: "UNAVAILABLE" | "RATE_LIMITED" };
  try {
    preview = await previewInvite(token, { ip: clientIp(await headers()) });
  } catch (e) {
    if (e instanceof JoinUnavailableError) preview = { ok: false, reason: "UNAVAILABLE" };
    else if (e instanceof JoinError && e.code === "RATE_LIMITED") preview = { ok: false, reason: "RATE_LIMITED" };
    else throw e;
  }
  if (!preview.ok) {
    return (
      <JoinShell>
        <div className="rounded-2xl border bg-card p-6 text-center shadow-sm" data-testid="invite-invalid">
          <div className="mx-auto mb-3 grid size-11 place-items-center rounded-full bg-muted text-muted-foreground">
            <LinkIcon className="size-5" />
          </div>
          <h1 className="text-lg font-semibold">{t(`invalid.${preview.reason}.title`)}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t(`invalid.${preview.reason}.body`)}</p>
          <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-center">
            <Button asChild variant="outline">
              <Link href="/login">{t("signIn")}</Link>
            </Button>
            <Button asChild>
              <Link href={`/${locale}/join`}>{t("haveCode")}</Link>
            </Button>
          </div>
        </div>
      </JoinShell>
    );
  }
  const session = await auth();
  const user = session?.user?.id ? await identityDb.user.findUnique({ where: { id: session.user.id }, select: { nameEn: true, nameAr: true, email: true } }) : null;
  const school = preview.school;
  const schoolName = pick(locale, school.nameEn, school.nameAr);
  const roles = preview.roles.map((r) => pick(locale, r.nameEn, r.nameAr)).join(", ");
  const headline = t("inviteHeadline", { school: schoolName });
  const detail =
    preview.kind === "PARENT"
      ? t("inviteAsParent", { count: preview.childCount })
      : preview.kind === "STUDENT"
        ? t("inviteAsStudent")
        : preview.isLink
          ? t("inviteAsStaffLink", { roles })
          : t("inviteAsStaff", { roles });
  const env = enabledOAuthProviders();
  return (
    <JoinShell>
      <InviteJoin
        token={token}
        school={{ name: schoolName, logoUrl: school.logoUrl, color: school.primaryColor }}
        headline={headline}
        detail={detail}
        email={preview.email}
        session={user ? { name: pick(locale, user.nameEn, user.nameAr), email: user.email } : null}
        providers={{ google: env.google && school.googleSignIn, microsoft: env.microsoft && school.microsoftSignIn }}
      />
      <p className="mt-4 text-center text-xs text-muted-foreground">{t("privacyNote")}</p>
    </JoinShell>
  );
}
