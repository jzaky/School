"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CheckCheck, Link2, Siren } from "lucide-react";
import { triageEventAction } from "@/server/actions/shield";
import { createIncidentFromEventAction, linkSecurityEventAction } from "@/server/actions/incidents";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, FormError, Input, Textarea } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Combobox } from "@/components/ui/combobox";
import { statusLabel } from "@/lib/status";

export interface IncidentOption {
  id: string;
  number: number;
  title: string;
  status: string;
  severity: string;
}

export function EventActions({ eventId, eventTitle, status, canWrite, incidents }: { eventId: string; eventTitle: string; status: string; canWrite: boolean; incidents: IncidentOption[] }) {
  const router = useRouter();
  const [triageOpen, setTriageOpen] = React.useState(false);
  const [linkOpen, setLinkOpen] = React.useState(false);
  const [createOpen, setCreateOpen] = React.useState(false);
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [triageStatus, setTriageStatus] = React.useState<"triaged" | "dismissed">("triaged");
  const [note, setNote] = React.useState("");
  const [incidentId, setIncidentId] = React.useState<string | null>(null);
  const [title, setTitle] = React.useState(eventTitle);
  const [summary, setSummary] = React.useState("");

  const linked = status === "linked";
  const permissionReason = !canWrite ? "Requires security:write" : undefined;
  const triageReason = permissionReason ?? (linked ? "Linked events are managed through their incident" : undefined);

  function reset() {
    setError(null);
    setPending(false);
  }

  async function submitTriage(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const r = await triageEventAction(eventId, { status: triageStatus, note });
    setPending(false);
    if (!r.ok) return setError(r.error);
    toast.success(triageStatus === "triaged" ? "Event marked as triaged" : "Event dismissed");
    setTriageOpen(false);
    setNote("");
    router.refresh();
  }

  async function submitLink(e: React.FormEvent) {
    e.preventDefault();
    if (!incidentId) return;
    setPending(true);
    setError(null);
    const r = await linkSecurityEventAction(incidentId, eventId, note);
    setPending(false);
    if (!r.ok) return setError(r.error);
    toast.success("Event linked to the incident");
    setLinkOpen(false);
    setNote("");
    router.refresh();
  }

  async function submitCreate(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const r = await createIncidentFromEventAction(eventId, { title, summary });
    setPending(false);
    if (!r.ok) return setError(r.error);
    toast.success(`Incident #${r.data.number} opened`);
    setCreateOpen(false);
    router.push(`/security/incidents/${r.data.id}`);
  }

  return (
    <>
      <Button variant="primary" disabled={!!triageReason} disabledReason={triageReason} onClick={() => setTriageOpen(true)}>
        <CheckCheck className="h-3.5 w-3.5" aria-hidden />
        Triage
      </Button>
      <Button disabled={!!triageReason || incidents.length === 0} disabledReason={triageReason ?? (incidents.length === 0 ? "No open incidents to link to" : undefined)} onClick={() => setLinkOpen(true)}>
        <Link2 className="h-3.5 w-3.5" aria-hidden />
        Link to incident
      </Button>
      <Button disabled={!!triageReason} disabledReason={triageReason} onClick={() => setCreateOpen(true)}>
        <Siren className="h-3.5 w-3.5" aria-hidden />
        Create incident
      </Button>

      <Dialog
        open={triageOpen}
        onOpenChange={(o) => {
          setTriageOpen(o);
          reset();
        }}
        title="Triage security event"
        description="Mark the event as reviewed, or dismiss it with a note. Both decisions are recorded in evidence."
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setTriageOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button form="triage-form" type="submit" variant="primary" loading={pending} disabled={triageStatus === "dismissed" && note.trim().length < 2} disabledReason="Dismissing an event requires a note">
              {triageStatus === "triaged" ? "Mark triaged" : "Dismiss"}
            </Button>
          </>
        }
      >
        <form id="triage-form" onSubmit={submitTriage} className="space-y-3">
          <Field label="Decision" htmlFor="triage-status">
            <Select id="triage-status" value={triageStatus} onValueChange={(v) => setTriageStatus(v as "triaged" | "dismissed")} options={[{ value: "triaged", label: "Triaged: reviewed, no incident needed" }, { value: "dismissed", label: "Dismissed: false positive or expected" }]} />
          </Field>
          <Field label="Note" htmlFor="triage-note" hint={triageStatus === "dismissed" ? "required" : "optional"}>
            <Textarea id="triage-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} placeholder="What was checked and why this outcome" autoFocus />
          </Field>
          <FormError error={error} />
        </form>
      </Dialog>

      <Dialog
        open={linkOpen}
        onOpenChange={(o) => {
          setLinkOpen(o);
          reset();
        }}
        title="Link to an incident"
        description="The event joins the incident timeline and its agent is added to the incident."
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setLinkOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button form="link-form" type="submit" variant="primary" loading={pending} disabled={!incidentId} disabledReason="Choose an incident">
              Link event
            </Button>
          </>
        }
      >
        <form id="link-form" onSubmit={submitLink} className="space-y-3">
          <Field label="Incident" htmlFor="link-incident">
            <Combobox id="link-incident" value={incidentId} onChange={setIncidentId} options={incidents.map((i) => ({ value: i.id, label: `#${i.number} ${i.title}`, description: `${statusLabel(i.status)}, ${statusLabel(i.severity)}` }))} placeholder="Select an open incident" searchPlaceholder="Search incidents" />
          </Field>
          <Field label="Note" htmlFor="link-note" hint="optional">
            <Input id="link-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} />
          </Field>
          <FormError error={error} />
        </form>
      </Dialog>

      <Dialog
        open={createOpen}
        onOpenChange={(o) => {
          setCreateOpen(o);
          reset();
        }}
        title="Create incident from this event"
        description="Severity and agent are taken from the event. Analysts with security:write are notified."
        footer={
          <>
            <Button variant="ghost" onClick={() => setCreateOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button form="create-incident-form" type="submit" variant="primary" loading={pending} disabled={title.trim().length < 3} disabledReason="Title needs at least 3 characters">
              Open incident
            </Button>
          </>
        }
      >
        <form id="create-incident-form" onSubmit={submitCreate} className="space-y-3">
          <Field label="Title" htmlFor="ci-title">
            <Input id="ci-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} autoFocus />
          </Field>
          <Field label="Summary" htmlFor="ci-summary" hint="optional, needed before resolving">
            <Textarea id="ci-summary" value={summary} onChange={(e) => setSummary(e.target.value)} maxLength={5000} />
          </Field>
          <FormError error={error} />
        </form>
      </Dialog>
    </>
  );
}
