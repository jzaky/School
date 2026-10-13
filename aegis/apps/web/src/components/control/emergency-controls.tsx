"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Ban, KeyRound, OctagonPause, Play, Plug, Wrench } from "lucide-react";
import { emergencyDisableIntegrationAction, emergencyRevokeCredentialAction, emergencyRevokeToolAction, emergencySuspendAgentAction, pauseGatewayAction, resumeGatewayAction } from "@/server/actions/gateway";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, FormError, Textarea } from "@/components/ui/input";
import { Combobox } from "@/components/ui/combobox";
import { Panel } from "@/components/ui/panel";
import { Note } from "@/components/ui/note";

export interface ControlAgent {
  id: string;
  name: string;
  slug: string;
  status: string;
  tools: { toolId: string; key: string; name: string }[];
}
export interface ControlIntegration {
  id: string;
  name: string;
  key: string;
  status: string;
  credentials: { id: string; name: string; revoked: boolean }[];
}

type Kind = "pause" | "resume" | "suspend" | "revoke-tool" | "disable-integration" | "revoke-credential";

const TITLES: Record<Kind, { title: string; description: string; confirm: string; danger: boolean }> = {
  pause: { title: "Pause the Action Gateway", description: "Every new request from every agent is refused at the door, before any policy is checked, until the gateway resumes. Requests that were already approved do not run. The pause and your reason are kept in the evidence record.", confirm: "Pause gateway", danger: true },
  resume: { title: "Resume the Action Gateway", description: "Agents can send requests again and your policies decide them as before.", confirm: "Resume gateway", danger: false },
  suspend: { title: "Suspend an agent", description: "The agent is turned away the moment it identifies itself, before any policy runs. Approvals already pending for it cannot be carried out. You can resume it from the agent's page.", confirm: "Suspend agent", danger: true },
  "revoke-tool": { title: "Revoke a tool from an agent", description: "The agent loses the tool from its next request onward. You can grant the tool again from the agent's page.", confirm: "Revoke tool", danger: true },
  "disable-integration": { title: "Disable an integration", description: "Every tool that uses this integration is refused at the gateway, and nothing is sent to the connected system.", confirm: "Disable integration", danger: true },
  "revoke-credential": { title: "Revoke a credential", description: "Nothing can run through this integration until a new secret is stored: every attempt is refused rather than risked (fail closed).", confirm: "Revoke credential", danger: true },
};

export function EmergencyControls({ paused, pausedReason, pausedBy, canAdmin, canControl, agents, integrations }: { paused: boolean; pausedReason: string | null; pausedBy: string | null; canAdmin: boolean; canControl: boolean; agents: ControlAgent[]; integrations: ControlIntegration[] }) {
  const router = useRouter();
  const [kind, setKind] = React.useState<Kind | null>(null);
  const [reason, setReason] = React.useState("");
  const [agentId, setAgentId] = React.useState<string | null>(null);
  const [toolId, setToolId] = React.useState<string | null>(null);
  const [integrationId, setIntegrationId] = React.useState<string | null>(null);
  const [credentialId, setCredentialId] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  function open(k: Kind) {
    setKind(k);
    setReason("");
    setAgentId(null);
    setToolId(null);
    setIntegrationId(null);
    setCredentialId(null);
    setError(null);
  }
  const agent = agents.find((a) => a.id === agentId);
  const integration = integrations.find((i) => i.id === integrationId);
  const needsReason = kind !== "resume";
  const ready = !!kind && (!needsReason || reason.trim().length >= 3) && (kind !== "suspend" || !!agentId) && (kind !== "revoke-tool" || (!!agentId && !!toolId)) && (kind !== "disable-integration" || !!integrationId) && (kind !== "revoke-credential" || !!credentialId);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!kind || !ready) return;
    setPending(true);
    setError(null);
    let r: { ok: true; data: unknown } | { ok: false; error: string };
    let message = "";
    switch (kind) {
      case "pause":
        r = await pauseGatewayAction(reason);
        message = "Gateway paused: every new request is now denied";
        break;
      case "resume":
        r = await resumeGatewayAction(reason);
        message = "Gateway resumed";
        break;
      case "suspend":
        r = await emergencySuspendAgentAction(agentId!, reason);
        message = `${agent?.name ?? "Agent"} suspended`;
        break;
      case "revoke-tool":
        r = await emergencyRevokeToolAction(agentId!, toolId!, reason);
        message = `Tool revoked from ${agent?.name ?? "agent"}`;
        break;
      case "disable-integration":
        r = await emergencyDisableIntegrationAction(integrationId!, reason);
        message = `${integration?.name ?? "Integration"} disabled`;
        break;
      case "revoke-credential":
        r = await emergencyRevokeCredentialAction(credentialId!, reason);
        message = "Credential revoked";
        break;
    }
    setPending(false);
    if (!r.ok) return setError(r.error);
    toast.success(message);
    setKind(null);
    router.refresh();
  }

  const meta = kind ? TITLES[kind] : null;
  const adminReason = "Requires org:admin";
  const controlReason = "Requires agents:control";
  const activeAgents = agents.filter((a) => a.status === "active");
  const credentialOptions = integrations.flatMap((i) => i.credentials.filter((cr) => !cr.revoked).map((cr) => ({ value: cr.id, label: `${i.name} / ${cr.name}`, description: i.key })));

  return (
    <Panel title="Emergency controls" description="Each control acts on the live system immediately and is kept in the evidence record with your reason." className={paused ? "border-deny" : undefined}>
      {paused ? (
        <Note tone="danger" className="mb-3">
          <strong>Gateway paused.</strong> {pausedReason ? `Reason: ${pausedReason}.` : ""} {pausedBy ? `By ${pausedBy}.` : ""} Every new request is refused.
        </Note>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {paused ? (
          <Button variant="primary" onClick={() => open("resume")} disabled={!canAdmin} disabledReason={adminReason}>
            <Play className="h-3.5 w-3.5" aria-hidden />
            Resume gateway
          </Button>
        ) : (
          <Button variant="danger" onClick={() => open("pause")} disabled={!canAdmin} disabledReason={adminReason}>
            <OctagonPause className="h-3.5 w-3.5" aria-hidden />
            Pause gateway
          </Button>
        )}
        <Button onClick={() => open("suspend")} disabled={!canControl || activeAgents.length === 0} disabledReason={!canControl ? controlReason : "There are no active agents to suspend"}>
          <Ban className="h-3.5 w-3.5" aria-hidden />
          Suspend agent
        </Button>
        <Button onClick={() => open("revoke-tool")} disabled={!canControl} disabledReason={controlReason}>
          <Wrench className="h-3.5 w-3.5" aria-hidden />
          Revoke tool from agent
        </Button>
        <Button onClick={() => open("disable-integration")} disabled={!canControl || integrations.every((i) => i.status !== "active")} disabledReason={!canControl ? controlReason : "There are no active integrations to disable"}>
          <Plug className="h-3.5 w-3.5" aria-hidden />
          Disable integration
        </Button>
        <Button onClick={() => open("revoke-credential")} disabled={!canControl || credentialOptions.length === 0} disabledReason={!canControl ? controlReason : "There are no live credentials to revoke"}>
          <KeyRound className="h-3.5 w-3.5" aria-hidden />
          Revoke credential
        </Button>
      </div>
      <Dialog
        open={kind !== null}
        onOpenChange={(o) => !o && setKind(null)}
        title={meta?.title ?? ""}
        description={meta?.description}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setKind(null)} disabled={pending}>
              Cancel
            </Button>
            <Button form="emergency-form" type="submit" variant={meta?.danger ? "danger" : "primary"} loading={pending} disabled={!ready} disabledReason="Complete the form and give a reason of at least 3 characters">
              {meta?.confirm}
            </Button>
          </>
        }
      >
        <form id="emergency-form" onSubmit={submit} className="space-y-3">
          {kind === "suspend" || kind === "revoke-tool" ? (
            <Field label="Agent" htmlFor="em-agent">
              <Combobox
                id="em-agent"
                value={agentId}
                onChange={(v) => {
                  setAgentId(v);
                  setToolId(null);
                }}
                options={(kind === "suspend" ? activeAgents : agents.filter((a) => a.tools.length > 0)).map((a) => ({ value: a.id, label: a.name, description: `${a.slug} · ${a.status}` }))}
                placeholder="Select an agent"
              />
            </Field>
          ) : null}
          {kind === "revoke-tool" ? (
            <Field label="Tool" htmlFor="em-tool">
              <Combobox id="em-tool" value={toolId} onChange={setToolId} options={(agent?.tools ?? []).map((t) => ({ value: t.toolId, label: t.key, description: t.name }))} placeholder={agent ? "Select a granted tool" : "Choose an agent first"} disabled={!agent} />
            </Field>
          ) : null}
          {kind === "disable-integration" ? (
            <Field label="Integration" htmlFor="em-integration">
              <Combobox id="em-integration" value={integrationId} onChange={setIntegrationId} options={integrations.filter((i) => i.status === "active").map((i) => ({ value: i.id, label: i.name, description: i.key }))} placeholder="Select an integration" />
            </Field>
          ) : null}
          {kind === "revoke-credential" ? (
            <Field label="Credential" htmlFor="em-credential">
              <Combobox id="em-credential" value={credentialId} onChange={setCredentialId} options={credentialOptions} placeholder="Select a credential" />
            </Field>
          ) : null}
          <Field label={needsReason ? "Reason" : "Note"} htmlFor="em-reason" hint={needsReason ? "required, kept in the evidence record" : "optional"}>
            <Textarea id="em-reason" value={reason} onChange={(e) => setReason(e.target.value)} autoFocus={kind === "pause" || kind === "resume"} placeholder="What happened and why this control is needed" />
          </Field>
          <FormError error={error} />
        </form>
      </Dialog>
    </Panel>
  );
}
