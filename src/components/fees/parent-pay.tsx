"use client";

import { useTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { CreditCard, Loader2, ShieldCheck, X } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { completeTestPaymentAction, payOnlineAction } from "@/server/fees/actions";
import { useFeeError } from "./form-bits";

/** Opens the payment page for one invoice (shown only when online payment is set up). */
export function PayButton({ invoiceId, label, size = "default" }: { invoiceId: string; label: string; size?: "default" | "sm" }) {
  const err = useFeeError();
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      size={size}
      disabled={pending}
      data-testid={`pay-${invoiceId}`}
      onClick={() =>
        start(async () => {
          const res = await payOnlineAction(invoiceId);
          if (!res.ok) return void toast.error(err(res.error));
          if (res.url.startsWith("/")) router.push(res.url.replace(/^\/(en|ar)/, ""));
          else window.location.assign(res.url);
        })
      }
    >
      {pending ? <Loader2 className="size-4 animate-spin" /> : <CreditCard className="size-4" />}
      {label}
    </Button>
  );
}

/** The built-in test checkout: no money moves; the result goes through the signed webhook path. */
export function TestCheckoutButtons({ linkId }: { linkId: string }) {
  const t = useTranslations("finance.parent");
  const err = useFeeError();
  const router = useRouter();
  const [pending, start] = useTransition();
  const finish = (outcome: "paid" | "failed") =>
    start(async () => {
      const res = await completeTestPaymentAction(linkId, outcome);
      if (!res.ok) return void toast.error(err(res.error));
      if (outcome === "paid") toast.success(t("testPaid"));
      router.push(outcome === "paid" ? `/fees?paid=${linkId}` : `/fees?cancelled=${linkId}`);
    });
  return (
    <div className="flex flex-col gap-2 sm:flex-row">
      <Button onClick={() => finish("paid")} disabled={pending} data-testid="test-pay">
        {pending ? <Loader2 className="size-4 animate-spin" /> : <ShieldCheck className="size-4" />}
        {t("testPayButton")}
      </Button>
      <Button variant="outline" onClick={() => finish("failed")} disabled={pending}>
        <X className="size-4" />
        {t("testCancelButton")}
      </Button>
    </div>
  );
}
