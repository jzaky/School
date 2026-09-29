"use client";

import { useTransition } from "react";
import { useTranslations } from "next-intl";
import { X } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { dismissFirstRunAction } from "@/server/access/actions";

export function DismissFirstRun() {
  const t = useTranslations("firstRun");
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={t("dismiss")}
      disabled={pending}
      data-testid="first-run-dismiss"
      onClick={() =>
        start(async () => {
          await dismissFirstRunAction();
          router.refresh();
        })
      }
    >
      <X className="size-4" />
    </Button>
  );
}
