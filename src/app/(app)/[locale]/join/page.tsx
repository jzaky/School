import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { auth, enabledOAuthProviders } from "@/auth";
import { identityDb } from "@/lib/tenant-db";
import { pick } from "@/lib/i18n-data";
import { joinAvailable } from "@/server/platform/join-lookup";
import { JoinShell } from "@/components/access/join-shell";
import { CodeJoin } from "@/components/access/join-flows";

export async function generateMetadata() {
  const t = await getTranslations("join");
  return { title: t("codeMetaTitle") };
}

export default async function JoinWithCodePage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ code?: string }> }) {
  const { locale } = await params;
  const { code } = await searchParams;
  const t = await getTranslations("join");
  const session = await auth();
  const user = session?.user?.id ? await identityDb.user.findUnique({ where: { id: session.user.id }, select: { nameEn: true, nameAr: true, email: true } }) : null;
  return (
    <JoinShell>
      {joinAvailable() ? (
        <CodeJoin initialCode={(code ?? "").toUpperCase().replace(/[^A-Z0-9-]/g, "").slice(0, 20)} session={user ? { name: pick(locale, user.nameEn, user.nameAr), email: user.email } : null} providers={enabledOAuthProviders()} />
      ) : (
        <div className="rounded-2xl border bg-card p-6 text-center shadow-sm">
          <h1 className="text-lg font-semibold">{t("invalid.UNAVAILABLE.title")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t("invalid.UNAVAILABLE.body")}</p>
        </div>
      )}
      <p className="mt-4 text-center text-sm text-muted-foreground">
        {t("alreadyMember")}{" "}
        <Link href="/login" className="font-medium text-brand hover:underline">
          {t("signIn")}
        </Link>
      </p>
      <p className="mt-2 text-center text-xs text-muted-foreground">{t("privacyNote")}</p>
    </JoinShell>
  );
}
