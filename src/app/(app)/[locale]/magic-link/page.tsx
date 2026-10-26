// Landing page of an emailed sign-in link. The link is used only when the person presses the button, so mail
// scanners that open links cannot spend it.
import NextLink from "next/link";
import { getTranslations } from "next-intl/server";
import { LogIn, XCircle } from "lucide-react";
import { AuthShell } from "@/components/sso/auth-shell";
import { Button } from "@/components/ui/button";
import { redeemMagicLinkAction } from "@/server/sso/actions";

export async function generateMetadata() {
  const t = await getTranslations("sso.magic");
  return { title: t("title") };
}

export default async function MagicLinkPage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ token?: string; state?: string }> }) {
  const [{ locale }, { token, state }] = await Promise.all([params, searchParams]);
  const t = await getTranslations("sso.magic");
  const usable = !!token && state !== "invalid";
  return (
    <AuthShell>
      {usable ? (
        <form action={redeemMagicLinkAction} className="rounded-xl border bg-card p-6 text-center shadow-xs" data-testid="magic-landing">
          <input type="hidden" name="token" value={token} />
          <input type="hidden" name="locale" value={locale} />
          <LogIn className="mx-auto size-10 text-brand" />
          <h1 className="mt-3 text-lg font-semibold">{t("title")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t("body")}</p>
          <Button type="submit" className="mt-5 w-full" data-testid="magic-continue">
            {t("continue")}
          </Button>
        </form>
      ) : (
        <div className="rounded-xl border bg-card p-6 text-center shadow-xs" data-testid="magic-invalid">
          <XCircle className="mx-auto size-10 text-danger" />
          <h1 className="mt-3 text-lg font-semibold">{t("invalidTitle")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t("invalidBody")}</p>
          <Button asChild className="mt-5">
            <NextLink href="/login">{t("again")}</NextLink>
          </Button>
        </div>
      )}
    </AuthShell>
  );
}
