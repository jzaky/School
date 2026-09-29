"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Loader2, MailWarning } from "lucide-react";
import { Button } from "@/components/ui/button";
import { resendVerificationAction } from "@/server/onboarding/signup-actions";

/** Shown to a new school's administrators until the founding administrator confirms their email. */
export function VerifyBanner({ email, canResend }: { email: string | null; canResend: boolean }) {
  const t = useTranslations("onboarding.verify");
  const [pending, start] = useTransition();
  const [sent, setSent] = useState(false);
  return (
    <div className="border-b border-warning/40 bg-warning-soft/60" role="status" data-testid="verify-banner">
      <div className="mx-auto flex max-w-7xl flex-col gap-2 px-4 py-2.5 text-sm sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
        <p className="flex items-start gap-2">
          <MailWarning className="mt-0.5 size-4 shrink-0" />
          <span>{canResend && email ? t("bannerOwner", { email }) : t("bannerOther")}</span>
        </p>
        {canResend && (
          <Button
            size="sm"
            variant="outline"
            className="shrink-0 bg-card"
            disabled={pending || sent}
            data-testid="verify-resend"
            onClick={() =>
              start(async () => {
                const res = await resendVerificationAction();
                if (!res.ok) return void toast.error(t(res.error === "rate" ? "resendRate" : res.error === "verified" ? "alreadyVerified" : "resendFailed"));
                setSent(true);
                toast.success(t("resent"));
              })
            }
          >
            {pending && <Loader2 className="size-4 animate-spin" />}
            {sent ? t("resentShort") : t("resend")}
          </Button>
        )}
      </div>
    </div>
  );
}
