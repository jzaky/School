import { getTranslations } from "next-intl/server";
import { CheckCircle2, XCircle } from "lucide-react";
import NextLink from "next/link";
import { Link } from "@/i18n/navigation";
import { auth } from "@/auth";
import { confirmEmailToken } from "@/server/onboarding/verification";
import { auditEmailVerified } from "@/server/onboarding/signup-flow";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/marketing/logo";

export async function generateMetadata() {
  const t = await getTranslations("onboarding.verify");
  return { title: t("metaTitle") };
}

export default async function VerifyEmailPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  const t = await getTranslations("onboarding.verify");
  const userId = token ? await confirmEmailToken(token) : null;
  if (userId) await auditEmailVerified(userId).catch(() => undefined);
  const session = await auth();
  const signedIn = Boolean(session?.user?.activeOrgId);
  return (
    <main className="grid min-h-dvh place-items-center px-4 py-10">
      <div className="w-full max-w-md space-y-6 text-center">
        <div className="flex justify-center">
          <Logo />
        </div>
        <div className="rounded-xl border bg-card p-8 shadow-xs" data-testid={userId ? "verify-ok" : "verify-failed"}>
          {userId ? <CheckCircle2 className="mx-auto size-10 text-success" /> : <XCircle className="mx-auto size-10 text-danger" />}
          <h1 className="mt-4 text-xl font-semibold">{userId ? t("okTitle") : t("failedTitle")}</h1>
          <p className="mt-2 text-sm text-muted-foreground">{userId ? t("okBody") : t("failedBody")}</p>
          <Button asChild className="mt-6">
            {signedIn ? <Link href={userId ? "/setup" : "/home"}>{userId ? t("continueSetup") : t("goHome")}</Link> : <NextLink href="/login">{t("signIn")}</NextLink>}
          </Button>
        </div>
      </div>
    </main>
  );
}
