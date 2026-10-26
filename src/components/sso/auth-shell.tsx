// The frame of the sign-in pages: logo and language switch on top, a narrow centered column, and the brand
// panel beside it on large screens. One column on phones (no horizontal scroll at 390px).
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Logo } from "@/components/marketing/logo";

export async function AuthShell({ children, toggle, aside }: { children: React.ReactNode; toggle?: React.ReactNode; aside?: React.ReactNode }) {
  const t = await getTranslations("auth");
  return (
    <div className="grid min-h-dvh lg:grid-cols-2">
      <div className="flex min-w-0 flex-col px-4 py-6 sm:px-10">
        <div className="flex items-center justify-between gap-2">
          <Link href="/">
            <Logo />
          </Link>
          {toggle}
        </div>
        <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center py-10">{children}</div>
      </div>
      <div className="relative hidden overflow-hidden bg-sidebar lg:block">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,oklch(0.45_0.12_252/.6),transparent_55%),radial-gradient(circle_at_80%_80%,oklch(0.7_0.12_85/.35),transparent_50%)]" />
        <div className="relative flex h-full flex-col justify-end p-12 text-white">
          {aside ?? (
            <>
              <p className="max-w-md text-2xl font-medium leading-snug">{t("quote")}</p>
              <p className="mt-4 text-sm text-white/60">{t("quoteBy")}</p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
