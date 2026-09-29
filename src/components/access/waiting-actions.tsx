"use client";

import { useTransition } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { LogOut, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { signOutAction } from "@/server/shell/actions";

export function WaitingActions({ homeHref, hasActive }: { homeHref: string; hasActive: boolean }) {
  const t = useTranslations("join");
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <div className="flex flex-col gap-2 sm:flex-row">
      <Button className="h-11 flex-1" onClick={() => router.push(homeHref)} data-testid="waiting-check">
        <RefreshCw className="size-4" />
        {hasActive ? t("goToSchool") : t("checkAgain")}
      </Button>
      <Button variant="outline" className="h-11" disabled={pending} onClick={() => start(() => signOutAction())}>
        <LogOut className="size-4" />
        {t("signOut")}
      </Button>
    </div>
  );
}
