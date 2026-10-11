"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Link2, MessageSquarePlus, RotateCcw, Search, ShieldCheck, UserPlus } from "lucide-react";
import { addIncidentNoteAction, assignIncidentAction, linkSecurityEventAction, setIncidentStatusAction } from "@/server/actions/incidents";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, FormError, Input, Textarea } from "@/components/ui/input";
import { Combobox } from "@/components/ui/combobox";
import { statusLabel } from "@/lib/status";
import { timeAgo } from "@/lib/utils";

export interface MemberOption {
  userId: string;
  name: string;
  roleName: string;
}

export interface EventOption {
  id: string;
  type: string;
  severity: string;
  title: string;
  status: string;
  createdAt: string;
}

type DialogKind = "investigating" | "contained" | "resolved" | "reopen" | "assign" | "note" | "link" | null;

export function IncidentActions({ incidentId, status, summary, assigneeId, canWrite, members, events }: { incidentId: string; status: string; summary: string; assigneeId: string | null; canWrite: boolean; members: MemberOption[]; events: EventOption[] }) {
  const router = useRouter();
  const [dialog, setDialog] = React.useState<DialogKind>(null);
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [note, setNote] = React.useState("");
  const [resolution, setResolution] = React.useState(summary);
  const [member, setMember] = React.useState<string | null>(assigneeId);
  const [eventId, setEventId] = React.useState<string | null>(null);
  const reason = canWrite ? undefined : "Requires security:write";

  function close() {
    setDialog(null);
    setError(null);
    setNote("");
    setEventId(null);
  }

  async function finish(r: { ok: true; data: unknown } | { ok: false; error: string }, message: string) {
    setPending(false);
    if (!r.ok) return setError(r.error);
    toast.success(message);
    close();
    router.refresh();
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    switch (dialog) {
      case "investigating":
      case "contained":
        return finish(await setIncidentStatusAction(incidentId, { status: dialog, note }), `Incident moved to ${statusLabel(dialog).toLowerCase()}`);
      case "resolved":
        return finish(await setIncidentStatusAction(incidentId, { status: "resolved", note, summary: resolution }), "Incident resolved");
      case "reopen":
        return finish(await setIncidentStatusAction(incidentId, { status: "investigating", note }), "Incident reopened");
      case "assign":
        return finish(await assignIncidentAction(incidentId, member, note), member ? "Incident assigned" : "Assignee removed");
      case "note":
        return finish(await addIncidentNoteAction(incidentId, note), "Note added");
      case "link":
        if (!eventId) return setPending(false);
        return finish(await linkSecurityEventAction(incidentId, eventId, note), "Security event linked");
      default:
        setPending(false);
    }
  }

  const resolved = status === "resolved";
  const titles: Record<Exclude<DialogKind, null>, { title: string; description: string; confirm: string }> = {
    investigating: { title: "Start investigating", description: "Marks the incident as actively investigated. A note is optional.", confirm: "Investigate" },
    contained: { title: "Mark contained", description: "The immediate risk is controlled. Investigation may continue.", confirm: "Mark contained" },
    resolved: { title: "Resolve incident", description: "A resolution summary of at least 10 characters is required and becomes part of the record.", confirm: "Resolve" },
    reopen: { title: "Reopen incident", description: "Moves the incident back to investigating. A note explaining why is required.", confirm: "Reopen" },
    assign: { title: "Assign incident", description: "Only members whose role carries security:write can be assigned.", confirm: "Assign" },
    note: { title: "Add note", description: "Notes are appended to the incident timeline and recorded in evidence.", confirm: "Add note" },
    link: { title: "Link security event", description: "Open or triaged events that are not yet part of an incident.", confirm: "Link event" },
  };
  const needsNote = dialog === "reopen" || dialog === "note";
  const canSubmit = !pending && (dialog === "resolved" ? resolution.trim().length >= 10 : dialog === "link" ? !!eventId : needsNote ? note.trim().length >= 2 : true);
  const submitReason = dialog === "resolved" && resolution.trim().length < 10 ? "Summary needs at least 10 characters" : dialog === "link" && !eventId ? "Choose an event" : needsNote && note.trim().length < 2 ? "A note is required" : undefined;

  return (
    <>
      {!resolved ? (
        <>
          {status === "open" ? (
            <Button variant="primary" disabled={!canWrite} disabledReason={reason} onClick={() => setDialog("investigating")}>
              <Search className="h-3.5 w-3.5" aria-hidden />
              Investigate
            </Button>
          ) : null}
          {status === "open" || status === "investigating" ? (
            <Button variant={status === "investigating" ? "primary" : "secondary"} disabled={!canWrite} disabledReason={reason} onClick={() => setDialog("contained")}>
              <ShieldCheck className="h-3.5 w-3.5" aria-hidden />
              Mark contained
            </Button>
          ) : null}
          <Button variant={status === "contained" ? "primary" : "secondary"} disabled={!canWrite} disabledReason={reason} onClick={() => setDialog("resolved")}>
            Resolve
          </Button>
        </>
      ) : (
        <Button variant="primary" disabled={!canWrite} disabledReason={reason} onClick={() => setDialog("reopen")}>
          <RotateCcw className="h-3.5 w-3.5" aria-hidden />
          Reopen
        </Button>
      )}
      <Button disabled={!canWrite} disabledReason={reason} onClick={() => setDialog("assign")}>
        <UserPlus className="h-3.5 w-3.5" aria-hidden />
        Assign
      </Button>
      <Button disabled={!canWrite} disabledReason={reason} onClick={() => setDialog("note")}>
        <MessageSquarePlus className="h-3.5 w-3.5" aria-hidden />
        Add note
      </Button>
      <Button disabled={!canWrite || resolved || events.length === 0} disabledReason={reason ?? (resolved ? "Reopen the incident before linking more events" : events.length === 0 ? "No unlinked security events" : undefined)} onClick={() => setDialog("link")}>
        <Link2 className="h-3.5 w-3.5" aria-hidden />
        Link event
      </Button>

      <Dialog
        open={dialog !== null}
        onOpenChange={(o) => !o && close()}
        title={dialog ? titles[dialog].title : ""}
        description={dialog ? titles[dialog].description : undefined}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={close} disabled={pending}>
              Cancel
            </Button>
            <Button form="incident-action-form" type="submit" variant={dialog === "reopen" ? "danger" : "primary"} loading={pending} disabled={!canSubmit} disabledReason={submitReason}>
              {dialog ? titles[dialog].confirm : ""}
            </Button>
          </>
        }
      >
        <form id="incident-action-form" onSubmit={submit} className="space-y-3">
          {dialog === "resolved" ? (
            <Field label="Resolution summary" htmlFor="inc-resolution" hint="required">
              <Textarea id="inc-resolution" value={resolution} onChange={(e) => setResolution(e.target.value)} maxLength={5000} autoFocus />
            </Field>
          ) : null}
          {dialog === "assign" ? (
            <Field label="Assignee" htmlFor="inc-assignee">
              <Combobox id="inc-assignee" value={member} onChange={setMember} options={members.map((m) => ({ value: m.userId, label: m.name, description: m.roleName }))} placeholder="Unassigned" allowClear searchPlaceholder="Search members" />
            </Field>
          ) : null}
          {dialog === "link" ? (
            <Field label="Security event" htmlFor="inc-event">
              <Combobox id="inc-event" value={eventId} onChange={setEventId} options={events.map((ev) => ({ value: ev.id, label: ev.title, description: `${ev.type} · ${statusLabel(ev.severity)} · ${timeAgo(ev.createdAt)}` }))} placeholder="Select an event" searchPlaceholder="Search events" />
            </Field>
          ) : null}
          {dialog === "note" ? (
            <Field label="Note" htmlFor="inc-note" hint="required">
              <Textarea id="inc-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={5000} autoFocus />
            </Field>
          ) : dialog ? (
            <Field label="Note" htmlFor="inc-note" hint={dialog === "reopen" ? "required" : "optional"}>
              <Input id="inc-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} autoFocus={dialog !== "resolved"} />
            </Field>
          ) : null}
          <FormError error={error} />
        </form>
      </Dialog>
    </>
  );
}
