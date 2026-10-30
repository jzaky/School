"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { dismissOnboardingAction, restoreOnboardingAction } from "@/server/actions/org";
import { Button } from "@/components/ui/button";

export function OnboardingDismissButton({ dismissed, canAdmin, size = "sm" }: { dismissed: boolean; canAdmin: boolean; size?: "sm" | "md" }) {
  const router = useRouter();
  const [pending, setPending] = React.useState(false);
  async function run() {
    setPending(true);
    const r = dismissed ? await restoreOnboardingAction() : await dismissOnboardingAction();
    setPending(false);
    if (!r.ok) return toast.error(`${r.error} Reload the page and try again; if it keeps failing, ask an owner to change the setting.`);
    toast.success(dismissed ? "Checklist restored for everyone in the organization" : "Checklist hidden. Restore it any time from Settings.");
    router.refresh();
  }
  return (
    <Button size={size} variant={dismissed ? "primary" : "ghost"} onClick={run} loading={pending} disabled={!canAdmin} disabledReason="Requires org:admin" data-testid="onboarding-dismiss">
      {dismissed ? "Restore checklist" : "Hide checklist"}
    </Button>
  );
}
