"use client";

import { useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Languages } from "lucide-react";
import { usePathname, useRouter } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { setMarketingLocaleAction } from "@/server/shell/actions";

/** Language switch for the public join pages (which live under a locale prefix). */
export function JoinLocaleToggle() {
  const locale = useLocale();
  const t = useTranslations("shell");
  const router = useRouter();
  const pathname = usePathname();
  const [pending, start] = useTransition();
  const other = locale === "ar" ? "en" : "ar";
  return (
    <Button
      variant="ghost"
      size="sm"
      className="gap-1.5"
      disabled={pending}
      aria-label={t("switchLanguage")}
      data-testid="language-toggle"
      onClick={() =>
        start(async () => {
          await setMarketingLocaleAction(other);
          const qs = typeof window !== "undefined" ? window.location.search : "";
          router.replace(`${pathname}${qs}`, { locale: other });
        })
      }
    >
      <Languages className="size-4" />
      {other === "ar" ? "العربية" : "English"}
    </Button>
  );
}

/** School identity at the top of a join card: logo when set, otherwise the school's initial. */
export function SchoolBadge({ name, logoUrl, color }: { name: string; logoUrl: string | null; color: string }) {
  return (
    <div className="flex items-center gap-3">
      {logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={logoUrl} alt="" className="size-12 rounded-xl border bg-white object-contain p-1" />
      ) : (
        <div className="grid size-12 place-items-center rounded-xl text-lg font-bold text-white" style={{ backgroundColor: /^#[0-9a-f]{6}$/i.test(color) ? color : "#0F4C81" }}>
          {name.trim().charAt(0).toUpperCase()}
        </div>
      )}
      <div className="min-w-0 text-base font-semibold leading-tight">{name}</div>
    </div>
  );
}
