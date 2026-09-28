"use client";

import { useTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { useRouter } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { cancelRequestAction } from "@/server/requests/actions";

export function CancelRequestButton({ requestId }: { requestId: string }) {
  const t = useTranslations("requests");
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      variant="outline"
      size="sm"
      disabled={pending}
      onClick={() => {
        if (!window.confirm(t("cancelConfirm"))) return;
        start(async () => {
          const res = await cancelRequestAction(requestId);
          if (res.ok) {
            toast.success(t("cancelled"));
            router.refresh();
          }
        });
      }}
    >
      {t("cancel")}
    </Button>
  );
}
