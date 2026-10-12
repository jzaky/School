"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowUpRight, OctagonPause, Play } from "lucide-react";
import { pauseGatewayAction, resumeGatewayAction } from "@/server/actions/gateway";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, FormError, Textarea } from "@/components/ui/input";
import { Note } from "@/components/ui/note";

/** Emergency pause for the Action Gateway, from Settings. The same actions back the gateway page controls. */
export function GatewayPauseControl({ paused, reason, by, canAdmin }: { paused: boolean; reason: string | null; by: string | null; canAdmin: boolean }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [text, setText] = React.useState("");
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const needsReason = !paused;
  const ready = !needsReason || text.trim().length >= 3;
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!ready) return;
    setPending(true);
    setError(null);
    const r = paused ? await resumeGatewayAction(text) : await pauseGatewayAction(text);
    setPending(false);
    if (!r.ok) return setError(`${r.error} Nothing changed. Reload the page and try again.`);
    toast.success(paused ? "Gateway resumed: agents can submit requests again" : "Gateway paused: every new request is denied until you resume");
    setOpen(false);
    setText("");
    router.refresh();
  }
  return (
    <div data-testid="gateway-pause">
      {paused ? (
        <Note tone="danger" className="mb-3">
          <strong>Gateway paused.</strong> Every new agent request is denied and approved actions do not run.{reason ? ` Reason: ${reason}.` : ""} {by ? `Paused by ${by}.` : ""}
        </Note>
      ) : (
        <p className="mb-3 text-xs text-fg-muted">The gateway is running. Pausing it denies every new request from every agent and voids live execution grants until you resume. Use it when something looks wrong and you need time to investigate.</p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {paused ? (
          <Button variant="primary" onClick={() => setOpen(true)} disabled={!canAdmin} disabledReason="Requires org:admin">
            <Play className="h-3.5 w-3.5" aria-hidden />
            Resume gateway
          </Button>
        ) : (
          <Button variant="danger" onClick={() => setOpen(true)} disabled={!canAdmin} disabledReason="Requires org:admin">
            <OctagonPause className="h-3.5 w-3.5" aria-hidden />
            Pause gateway
          </Button>
        )}
        <Link href="/gateway" className="inline-flex items-center gap-0.5 text-xs text-accent hover:underline">
          More emergency controls <ArrowUpRight className="h-3 w-3" aria-hidden />
        </Link>
      </div>
      <Dialog
        open={open}
        onOpenChange={(o) => !o && setOpen(false)}
        title={paused ? "Resume the Action Gateway" : "Pause the Action Gateway"}
        description={paused ? "Agents can submit requests again and policies apply as before." : "Every new request from every agent is denied until the gateway resumes. Requests already approved do not execute. The pause is recorded in evidence with your reason."}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button form="gateway-pause-form" type="submit" variant={paused ? "primary" : "danger"} loading={pending} disabled={!ready} disabledReason="Give a reason of at least 3 characters">
              {paused ? "Resume gateway" : "Pause gateway"}
            </Button>
          </>
        }
      >
        <form id="gateway-pause-form" onSubmit={submit} className="space-y-3">
          <Field label={needsReason ? "Reason" : "Note"} htmlFor="gw-reason" hint={needsReason ? "required, recorded in evidence" : "optional, recorded in evidence"}>
            <Textarea id="gw-reason" value={text} onChange={(e) => setText(e.target.value)} autoFocus placeholder={needsReason ? "What happened and why the gateway must stop" : "What was checked before resuming"} />
          </Field>
          <FormError error={error} />
        </form>
      </Dialog>
    </div>
  );
}
