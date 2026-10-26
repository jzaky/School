"use client";

import { useTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Loader2, Lock, LockOpen } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { setRegisterClosedAction } from "@/server/attendance/actions";

/** Attendance office: close a register (later changes need attendance.manage and are audited) or reopen it. */
export function CloseRegisterButton({ regRef, closed }: { regRef: { classId: string; date: string; periodNo: number }; closed: boolean }) {
  const t = useTranslations("attendance.take");
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      variant="outline"
      disabled={pending}
      data-testid={closed ? "reopen-register" : "close-register"}
      onClick={() =>
        start(async () => {
          const res = await setRegisterClosedAction({ ref: regRef, closed: !closed });
          if (!res.ok) return void toast.error(t.has(`error.${res.error}`) ? t(`error.${res.error}`) : t("error.generic"));
          toast.success(closed ? t("reopened") : t("closedToast"));
          router.refresh();
        })
      }
    >
      {pending ? <Loader2 className="size-4 animate-spin" /> : closed ? <LockOpen className="size-4" /> : <Lock className="size-4" />}
      {closed ? t("reopen") : t("close")}
    </Button>
  );
}
