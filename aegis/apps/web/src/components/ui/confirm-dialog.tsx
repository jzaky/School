"use client";
import * as React from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "./button";
import { Dialog } from "./dialog";
import { Field, FormError, Input, Textarea } from "./input";

export interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  description?: React.ReactNode;
  confirmLabel?: string;
  danger?: boolean;
  /** Ask for a free-text reason (required, min 3 chars). */
  reason?: { label?: string; placeholder?: string; required?: boolean };
  /** Require the user to type this exact word. */
  typed?: string;
  warning?: React.ReactNode;
  onConfirm: (input: { reason: string }) => Promise<string | void> | string | void;
}

export function ConfirmDialog({ open, onOpenChange, title, description, confirmLabel = "Confirm", danger, reason, typed, warning, onConfirm }: ConfirmDialogProps) {
  const [reasonText, setReasonText] = React.useState("");
  const [typedText, setTypedText] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);
  React.useEffect(() => {
    if (!open) {
      setReasonText("");
      setTypedText("");
      setError(null);
      setPending(false);
    }
  }, [open]);
  const reasonOk = !reason || !(reason.required ?? true) || reasonText.trim().length >= 3;
  const typedOk = !typed || typedText === typed;
  const canSubmit = reasonOk && typedOk && !pending;
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setPending(true);
    setError(null);
    try {
      const err = await onConfirm({ reason: reasonText.trim() });
      if (err) setError(err);
      else onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setPending(false);
    }
  }
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={description}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          <Button form="confirm-dialog-form" type="submit" variant={danger ? "danger" : "primary"} disabled={!canSubmit} loading={pending} disabledReason={!typedOk ? `Type ${typed} to continue` : !reasonOk ? "A reason of at least 3 characters is required" : undefined}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <form id="confirm-dialog-form" onSubmit={submit} className="space-y-3">
        {warning ? (
          <div className="flex gap-2 rounded-md border border-deny/30 bg-deny/10 px-3 py-2 text-xs text-fg">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-deny" aria-hidden />
            <div>{warning}</div>
          </div>
        ) : null}
        {reason ? (
          <Field label={reason.label ?? "Reason"} htmlFor="confirm-reason" hint={(reason.required ?? true) ? "required, recorded in evidence" : "optional"}>
            <Textarea id="confirm-reason" value={reasonText} onChange={(e) => setReasonText(e.target.value)} placeholder={reason.placeholder ?? "Why is this action being taken?"} autoFocus />
          </Field>
        ) : null}
        {typed ? (
          <Field
            label={
              <>
                Type <span className="font-mono text-fg">{typed}</span> to confirm
              </>
            }
            htmlFor="confirm-typed"
          >
            <Input id="confirm-typed" value={typedText} onChange={(e) => setTypedText(e.target.value)} autoComplete="off" spellCheck={false} className="font-mono" />
          </Field>
        ) : null}
        <FormError error={error} />
      </form>
    </Dialog>
  );
}
