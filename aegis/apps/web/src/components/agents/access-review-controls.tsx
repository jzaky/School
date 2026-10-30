"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ClipboardCheck } from "lucide-react";
import { completeAccessReviewAction, decideAccessReviewItemAction, startAccessReviewAction } from "@/server/actions/access-reviews";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, FormError, Input, Textarea } from "@/components/ui/input";

export function StartReviewButton({ canControl, open }: { canControl: boolean; open: boolean }) {
  const router = useRouter();
  const [show, setShow] = React.useState(false);
  const [title, setTitle] = React.useState("");
  const [due, setDue] = React.useState("14");
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const r = await startAccessReviewAction({ title, dueInDays: Number(due) });
    setPending(false);
    if (!r.ok) return setError(r.error);
    toast.success(`Review started with ${r.data.items} grants to decide`);
    setShow(false);
    router.refresh();
  }
  return (
    <>
      <Button
        variant="primary"
        onClick={() => {
          const q = Math.floor(new Date().getMonth() / 3) + 1;
          setTitle(`Q${q} ${new Date().getFullYear()} agent access review`);
          setDue("14");
          setError(null);
          setShow(true);
        }}
        disabled={!canControl || open}
        disabledReason={!canControl ? "Requires agents:control" : "Complete the open review first"}
      >
        <ClipboardCheck className="h-3.5 w-3.5" aria-hidden />
        Start review
      </Button>
      <Dialog
        open={show}
        onOpenChange={setShow}
        title="Start an access review"
        description="AEGIS takes a snapshot of every tool and resource each agent can use now, with how often it was used. A person then keeps or removes each one."
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setShow(false)} disabled={pending}>
              Cancel
            </Button>
            <Button form="start-review-form" type="submit" variant="primary" loading={pending} disabled={title.trim().length < 3} disabledReason="Give the review a title">
              Start review
            </Button>
          </>
        }
      >
        <form id="start-review-form" onSubmit={submit} className="space-y-3">
          <Field label="Title" htmlFor="ar-title">
            <Input id="ar-title" value={title} onChange={(e) => setTitle(e.target.value)} />
          </Field>
          <Field label="Due in (days)" htmlFor="ar-due">
            <Input id="ar-due" type="number" min={1} max={180} value={due} onChange={(e) => setDue(e.target.value)} />
          </Field>
          <FormError error={error} />
        </form>
      </Dialog>
    </>
  );
}

export function DecideItem({ itemId, label, canControl, unused }: { itemId: string; label: string; canControl: boolean; unused: boolean }) {
  const router = useRouter();
  const [remove, setRemove] = React.useState(false);
  const [note, setNote] = React.useState("");
  const [pending, setPending] = React.useState<"keep" | "remove" | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  async function decide(decision: "keep" | "remove") {
    setPending(decision);
    setError(null);
    const r = await decideAccessReviewItemAction(itemId, { decision, note: decision === "remove" ? note : "" });
    setPending(null);
    if (!r.ok) {
      if (decision === "keep") toast.error(r.error);
      return setError(r.error);
    }
    toast.success(decision === "keep" ? `Kept ${label}` : `Removed ${label}: revoked now`);
    setRemove(false);
    router.refresh();
  }
  return (
    <div className="flex justify-end gap-1.5">
      <Button size="sm" variant="ghost" onClick={() => decide("keep")} loading={pending === "keep"} disabled={!canControl} disabledReason="Requires agents:control">
        Keep
      </Button>
      <Button size="sm" variant={unused ? "danger" : "secondary"} onClick={() => { setNote(unused ? "Not used in the review window" : ""); setError(null); setRemove(true); }} disabled={!canControl} disabledReason="Requires agents:control">
        Remove
      </Button>
      <Dialog
        open={remove}
        onOpenChange={setRemove}
        title={`Remove ${label}`}
        description="The grant is revoked at once: the agent's next request that needs it is refused. The reason is kept in the evidence record."
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setRemove(false)} disabled={!!pending}>
              Cancel
            </Button>
            <Button variant="danger" onClick={() => decide("remove")} loading={pending === "remove"} disabled={note.trim().length < 5} disabledReason="Give a reason of at least 5 characters">
              Remove access
            </Button>
          </>
        }
      >
        <Field label="Reason" htmlFor={`ar-note-${itemId}`} hint="required">
          <Textarea id={`ar-note-${itemId}`} value={note} onChange={(e) => setNote(e.target.value)} autoFocus />
        </Field>
        <FormError error={error} />
      </Dialog>
    </div>
  );
}

export function CompleteReviewButton({ reviewId, undecided, canControl }: { reviewId: string; undecided: number; canControl: boolean }) {
  const router = useRouter();
  const [pending, setPending] = React.useState(false);
  return (
    <Button
      variant="primary"
      loading={pending}
      disabled={!canControl || undecided > 0}
      disabledReason={!canControl ? "Requires agents:control" : `${undecided} item(s) still need a decision`}
      onClick={async () => {
        setPending(true);
        const r = await completeAccessReviewAction(reviewId);
        setPending(false);
        if (!r.ok) return toast.error(r.error);
        toast.success("Review completed and recorded");
        router.refresh();
      }}
    >
      Complete review
    </Button>
  );
}
