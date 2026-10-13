"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Play } from "lucide-react";
import { transitionAgentAction } from "@/server/actions/agents";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { LIFECYCLE_ACTIONS, type LifecycleAction } from "@/lib/agent-lifecycle";

export function AgentLifecycleActions({ agentId, agentName, status, allowedNext, canWrite, canControl }: { agentId: string; agentName: string; status: string; allowedNext: string[]; canWrite: boolean; canControl: boolean }) {
  const router = useRouter();
  const [pendingAction, setPendingAction] = React.useState<LifecycleAction | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);
  const actions = allowedNext.map((to) => LIFECYCLE_ACTIONS[to as LifecycleAction["to"]]).filter(Boolean);

  async function run(action: LifecycleAction, reason: string) {
    const r = await transitionAgentAction(agentId, action.to, reason);
    if (!r.ok) return r.error;
    toast.success(`${agentName}: ${action.label.toLowerCase()} recorded`);
    router.refresh();
  }

  if (actions.length === 0) return <span className="text-xs text-fg-dim">This agent is archived. No further status changes are possible.</span>;

  return (
    <>
      {actions.map((a) => {
        const isResume = a.to === "active" && status === "suspended";
        const permission = isResume ? "agents:control" : a.permission;
        const allowed = permission === "agents:control" ? canControl : canWrite;
        const label = isResume ? "Resume" : a.label;
        const needsDialog = a.reason || a.typed || isResume;
        return (
          <Button
            key={a.to}
            variant={isResume ? "primary" : a.variant}
            disabled={!allowed || busy !== null}
            disabledReason={!allowed ? `Requires ${permission}` : undefined}
            loading={busy === a.to}
            title={a.description}
            onClick={async () => {
              if (needsDialog) return setPendingAction(isResume ? { ...a, label: "Resume", reason: true, description: "The agent can act again. Your reason is kept in the evidence record." } : a);
              setBusy(a.to);
              const err = await run(a, `${label.toLowerCase()} from console`);
              setBusy(null);
              if (err) toast.error(err);
            }}
          >
            {isResume ? <Play className="h-3.5 w-3.5" aria-hidden /> : null}
            {label}
          </Button>
        );
      })}
      <ConfirmDialog
        open={pendingAction !== null}
        onOpenChange={(o) => !o && setPendingAction(null)}
        title={pendingAction ? `${pendingAction.label} ${agentName}` : ""}
        description={pendingAction?.description}
        confirmLabel={pendingAction?.label}
        danger={pendingAction?.variant === "danger"}
        reason={pendingAction ? { required: true } : undefined}
        typed={pendingAction?.typed}
        warning={pendingAction?.warning}
        onConfirm={async ({ reason }) => {
          if (!pendingAction) return;
          const text = pendingAction.label === "Resume" ? `resume: ${reason}` : reason;
          return run(pendingAction, text);
        }}
      />
    </>
  );
}
