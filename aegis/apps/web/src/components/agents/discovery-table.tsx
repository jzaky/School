"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { resolveDiscoveredAgentAction } from "@/server/actions/agent-access";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";

export interface DiscoveredRow {
  id: string;
  name: string;
  platform: string;
  source: string;
  externalId: string;
  status: string;
  observations: number;
  firstSeenAt: string;
  lastSeenAt: string;
  linkedAgent: string | null;
  note: string | null;
}

export function DiscoveryTable({ rows, agents, canWrite }: { rows: DiscoveredRow[]; agents: { id: string; name: string }[]; canWrite: boolean }) {
  const router = useRouter();
  const [linkTo, setLinkTo] = React.useState<Record<string, string>>({});
  const [note, setNote] = React.useState<Record<string, string>>({});
  const [busy, setBusy] = React.useState<string | null>(null);
  async function resolve(id: string, input: { action: "link"; agentId: string } | { action: "ignore"; note: string }) {
    setBusy(id);
    const r = await resolveDiscoveredAgentAction(id, input);
    setBusy(null);
    if (!r.ok) return toast.error(r.error);
    toast.success(input.action === "link" ? "Linked to the registered agent" : "Dismissed");
    router.refresh();
  }
  if (!rows.length) return <p className="p-4 text-sm text-fg-dim">No system has reported an AI agent yet.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm" aria-label="Discovered agents">
        <thead className="text-start text-xs text-fg-muted">
          <tr className="border-b border-line">
            <th className="px-4 py-2 text-start font-medium">Agent</th>
            <th className="px-4 py-2 text-start font-medium">Seen by</th>
            <th className="px-4 py-2 text-start font-medium">Times seen</th>
            <th className="px-4 py-2 text-start font-medium">Last seen</th>
            <th className="px-4 py-2 text-start font-medium">Status</th>
            <th className="px-4 py-2 text-start font-medium">Action</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-b border-line align-top last:border-0" data-discovered={r.externalId}>
              <td className="px-4 py-2">
                <div className="font-medium text-fg">{r.name}</div>
                <div className="font-mono text-xs text-fg-muted">
                  {r.externalId}
                  {r.platform ? ` · ${r.platform}` : ""}
                </div>
              </td>
              <td className="px-4 py-2 text-xs text-fg-muted">{r.source}</td>
              <td className="px-4 py-2 tabular">{r.observations}</td>
              <td className="px-4 py-2 text-xs">{new Date(r.lastSeenAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}</td>
              <td className="px-4 py-2">
                <Badge tone={r.status === "unregistered" ? "approval" : r.status === "linked" ? "allow" : "neutral"}>{r.status === "unregistered" ? "Not registered" : r.status === "linked" ? `Linked: ${r.linkedAgent ?? "agent"}` : "Dismissed"}</Badge>
                {r.note ? <div className="mt-1 text-xs text-fg-muted">{r.note}</div> : null}
              </td>
              <td className="px-4 py-2">
                {r.status === "unregistered" ? (
                  <div className="flex min-w-64 flex-col gap-2">
                    <div className="flex gap-2">
                      <Select size="sm" aria-label="Registered agent to link" value={linkTo[r.id] ?? ""} onValueChange={(v) => setLinkTo({ ...linkTo, [r.id]: v })} options={agents.map((a) => ({ value: a.id, label: a.name }))} placeholder="Registered agent" disabled={!canWrite} />
                      <Button size="sm" disabled={!canWrite || !linkTo[r.id] || busy === r.id} disabledReason={!canWrite ? "Requires agents:write" : "Choose the registered agent"} onClick={() => resolve(r.id, { action: "link", agentId: linkTo[r.id]! })}>
                        Link
                      </Button>
                    </div>
                    <div className="flex gap-2">
                      <Input aria-label="Why it can be dismissed" className="h-7 text-xs" value={note[r.id] ?? ""} onChange={(e) => setNote({ ...note, [r.id]: e.target.value })} placeholder="Why it is not an agent to govern" disabled={!canWrite} />
                      <Button size="sm" variant="ghost" disabled={!canWrite || (note[r.id] ?? "").trim().length < 3 || busy === r.id} disabledReason={!canWrite ? "Requires agents:write" : "Say why"} onClick={() => resolve(r.id, { action: "ignore", note: note[r.id]! })}>
                        Dismiss
                      </Button>
                    </div>
                  </div>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
