"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { installPilotKitAction, setWatchOnlyAction } from "@/server/actions/pilots";
import { Button } from "@/components/ui/button";

export function InstallKitButton({ kitKey, kitName, canInstall }: { kitKey: string; kitName: string; canInstall: boolean }) {
  const router = useRouter();
  const [pending, setPending] = React.useState(false);
  return (
    <Button
      size="sm"
      loading={pending}
      disabled={!canInstall}
      disabledReason="Requires the agents:write and policies:activate permissions"
      data-testid={`pilot-install-${kitKey}`}
      onClick={async () => {
        setPending(true);
        const r = await installPilotKitAction({ key: kitKey, watchOnly: true });
        setPending(false);
        if (!r.ok) return toast.error(r.error);
        const created = r.data.agents.filter((a) => a.created).length + r.data.policies.filter((p) => p.created).length;
        toast.success(created ? `${kitName} kit installed in watch-only mode` : `${kitName} kit was already installed`);
        router.refresh();
      }}
    >
      Install in watch-only mode
    </Button>
  );
}

export function WatchOnlyToggle({ agentId, agentName, enabled, canEnable, canDisable }: { agentId: string; agentName: string; enabled: boolean; canEnable: boolean; canDisable: boolean }) {
  const router = useRouter();
  const [pending, setPending] = React.useState(false);
  const allowed = enabled ? canDisable : canEnable;
  return (
    <Button
      size="sm"
      variant={enabled ? "primary" : "secondary"}
      loading={pending}
      disabled={!allowed}
      disabledReason={enabled ? "Requires the agents:control permission" : "Requires the policies:activate permission"}
      data-testid={`watch-only-${agentId}`}
      onClick={async () => {
        const reason = enabled ? "Watch period over: enforcing" : window.prompt(`Why should ${agentName} run in watch-only mode? Its policies will record but not hold or refuse actions.`) ?? "";
        if (!enabled && reason.trim().length < 5) return toast.error("Give a reason of at least 5 characters");
        setPending(true);
        const r = await setWatchOnlyAction({ agentId, enabled: !enabled, reason });
        setPending(false);
        if (!r.ok) return toast.error(r.error);
        toast.success(enabled ? `${agentName}: policies now enforced` : `${agentName}: watch-only mode on`);
        router.refresh();
      }}
    >
      {enabled ? "Switch to enforcing" : "Use watch-only"}
    </Button>
  );
}
