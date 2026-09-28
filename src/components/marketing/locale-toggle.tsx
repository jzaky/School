"use client";

import { useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { Languages } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { setMarketingLocaleAction } from "@/server/shell/actions";

export function MarketingLocaleToggle({ className }: { className?: string }) {
  const locale = useLocale();
  const t = useTranslations("shell");
  const router = useRouter();
  const [pending, start] = useTransition();
  const other = locale === "ar" ? "en" : "ar";
  return (
    <Button
      variant="ghost"
      size="sm"
      className={cn("gap-1.5", className)}
      disabled={pending}
      aria-label={t("switchLanguage")}
      data-testid="language-toggle"
      onClick={() =>
        start(async () => {
          await setMarketingLocaleAction(other);
          router.refresh();
        })
      }
    >
      <Languages className="size-4" />
      {other === "ar" ? "العربية" : "English"}
    </Button>
  );
}
