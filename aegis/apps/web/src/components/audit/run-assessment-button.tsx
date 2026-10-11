"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Play, RefreshCw } from "lucide-react";
import { runAssessmentAction } from "@/server/actions/audit";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

export function RunAssessmentButton({ assessmentId, status, canWrite, controlCount }: { assessmentId: string; status: string; canWrite: boolean; controlCount: number }) {
  const router = useRouter();
  const [running, setRunning] = React.useState(false);
  const [confirm, setConfirm] = React.useState(false);
  const rerun = status === "completed" || status === "failed";
  const reason = !canWrite ? "Requires audit:write" : status === "running" ? "The assessment is already running" : undefined;

  async function run() {
    setRunning(true);
    const r = await runAssessmentAction(assessmentId);
    setRunning(false);
    if (!r.ok) return r.error;
    if (r.data.status === "completed") toast.success(`Assessment completed: ${r.data.coveragePercent ?? 0}% coverage`);
    else toast.error(`Assessment ${r.data.status}${r.data.error ? `: ${r.data.error}` : ""}`);
    router.refresh();
  }

  return (
    <>
      <Button
        variant={rerun ? "secondary" : "primary"}
        loading={running}
        disabled={!!reason}
        disabledReason={reason}
        onClick={async () => {
          if (rerun) return setConfirm(true);
          const err = await run();
          if (err) toast.error(err);
        }}
      >
        {rerun ? <RefreshCw className="h-3.5 w-3.5" aria-hidden /> : <Play className="h-3.5 w-3.5" aria-hidden />}
        {running ? `Running ${controlCount} controls` : rerun ? "Re-run" : "Run assessment"}
      </Button>
      <ConfirmDialog open={confirm} onOpenChange={setConfirm} title="Re-run this assessment" description="Findings and cited artifacts are replaced by a fresh run over the current documents. Human validations on the previous run are not carried over." confirmLabel="Re-run" onConfirm={run} />
    </>
  );
}
