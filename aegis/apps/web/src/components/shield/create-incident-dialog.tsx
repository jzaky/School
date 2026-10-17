"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { createIncidentAction } from "@/server/actions/incidents";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, FormError, Input, Textarea } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { statusLabel } from "@/lib/status";
import { severityTone } from "./format";

export function CreateIncidentDialog({ canWrite, agents }: { canWrite: boolean; agents: { id: string; name: string; slug: string }[] }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [title, setTitle] = React.useState("");
  const [severity, setSeverity] = React.useState("medium");
  const [summary, setSummary] = React.useState("");
  const [agentIds, setAgentIds] = React.useState<string[]>([]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const r = await createIncidentAction({ title: title.trim(), severity, summary: summary.trim(), agentIds, securityEventIds: [], assigneeId: null });
    setPending(false);
    if (!r.ok) return setError(r.error);
    toast.success(`Incident #${r.data.number} opened`);
    setOpen(false);
    router.push(`/security/incidents/${r.data.id}`);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setError(null);
      }}
      trigger={
        <Button variant="primary" disabled={!canWrite} disabledReason="Requires security:write">
          <Plus className="h-3.5 w-3.5" aria-hidden />
          New incident
        </Button>
      }
      title="Open an incident"
      description="A numbered case that groups security events, notes and status changes. Analysts with security:write are notified."
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
            Cancel
          </Button>
          <Button form="create-incident" type="submit" variant="primary" loading={pending} disabled={title.trim().length < 3} disabledReason="Title needs at least 3 characters">
            Open incident
          </Button>
        </>
      }
    >
      <form id="create-incident" onSubmit={submit} className="grid gap-3 md:grid-cols-2">
        <Field label="Title" htmlFor="inc-title" className="md:col-span-2">
          <Input id="inc-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} autoFocus />
        </Field>
        <Field label="Severity" htmlFor="inc-severity">
          <Select id="inc-severity" value={severity} onValueChange={setSeverity} options={["low", "medium", "high", "critical"].map((s) => ({ value: s, label: <Badge tone={severityTone(s)}>{statusLabel(s)}</Badge> }))} />
        </Field>
        <Field label="Summary" htmlFor="inc-summary" hint="optional now, required to resolve" className="md:col-span-2">
          <Textarea id="inc-summary" value={summary} onChange={(e) => setSummary(e.target.value)} maxLength={5000} />
        </Field>
        <fieldset className="md:col-span-2">
          <legend className="mb-1 block text-xs font-medium text-fg-muted">Agents involved</legend>
          <div className="grid max-h-48 gap-0.5 overflow-y-auto rounded-md border border-line p-1 sm:grid-cols-2">
            {agents.map((a) => (
              <Checkbox key={a.id} checked={agentIds.includes(a.id)} onCheckedChange={(v) => setAgentIds((prev) => (v ? [...prev, a.id] : prev.filter((x) => x !== a.id)))} label={a.name} description={a.slug} />
            ))}
          </div>
        </fieldset>
        <div className="md:col-span-2">
          <FormError error={error} />
        </div>
      </form>
    </Dialog>
  );
}
