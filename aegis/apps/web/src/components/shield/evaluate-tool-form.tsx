"use client";
import * as React from "react";
import { Check, Minus, Play, X } from "lucide-react";
import type { ToolSecurityReport } from "@aegis/core";
import { evaluateToolSecurityAction } from "@/server/actions/shield";
import { Panel } from "@/components/ui/panel";
import { Button } from "@/components/ui/button";
import { Field, FormError, Input, Textarea } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Combobox } from "@/components/ui/combobox";
import { Badge } from "@/components/ui/badge";
import { Note } from "@/components/ui/note";
import { SimpleTable, Td, Th, Tr } from "@/components/ui/simple-table";
import { statusLabel } from "@/lib/status";
import { DATA_ACTION_LABELS, dataActionTone, severityTone } from "./format";

type Mark = "pass" | "fail" | "na";

function MarkIcon({ mark }: { mark: Mark }) {
  if (mark === "pass") return <Check className="h-4 w-4 text-allow" aria-label="pass" />;
  if (mark === "fail") return <X className="h-4 w-4 text-deny" aria-label="fail" />;
  return <Minus className="h-4 w-4 text-fg-dim" aria-label="not applicable" />;
}

function CheckRow({ mark, label, detail }: { mark: Mark; label: string; detail: React.ReactNode }) {
  return (
    <li className="flex items-start gap-3 border-b border-line py-2 last:border-b-0" data-check={label} data-mark={mark}>
      <span className="mt-0.5 shrink-0">
        <MarkIcon mark={mark} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm text-fg">{label}</span>
        <span className="block text-xs text-fg-muted">{detail}</span>
      </span>
    </li>
  );
}

const VERDICT: Record<ToolSecurityReport["verdict"], { label: string; tone: "allow" | "deny" | "approval" }> = {
  would_deny: { label: "Would be denied", tone: "deny" },
  would_block: { label: "Would be blocked by data protection", tone: "deny" },
  would_require_approval: { label: "Would require approval", tone: "approval" },
  passes_structural_checks: { label: "Passes structural checks", tone: "allow" },
};

export function EvaluateToolForm({ agents, tools, resources, initial }: { agents: { id: string; name: string; slug: string; status: string }[]; tools: { key: string; name: string }[]; resources: { key: string; name: string; classification: string }[]; initial?: { agentId?: string; toolKey?: string } }) {
  const [agentId, setAgentId] = React.useState<string | null>(initial?.agentId ?? null);
  const [toolKey, setToolKey] = React.useState<string>(initial?.toolKey ?? tools[0]?.key ?? "");
  const [resourceKey, setResourceKey] = React.useState<string | null>(null);
  const [destination, setDestination] = React.useState("");
  const [params, setParams] = React.useState('{\n  "format": "csv"\n}');
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [report, setReport] = React.useState<ToolSecurityReport | null>(null);

  async function run(e: React.FormEvent) {
    e.preventDefault();
    if (!agentId || !toolKey) return;
    setPending(true);
    setError(null);
    const r = await evaluateToolSecurityAction({ agentId, toolKey, resourceKey: resourceKey ?? undefined, destinationDomain: destination.trim() || undefined, params });
    setPending(false);
    if (!r.ok) return setError(r.error);
    setReport(r.data);
  }

  const marks = report
    ? {
        grant: (report.grant.status === "granted" ? "pass" : "fail") as Mark,
        destination: (report.destination.result === "not_applicable" ? "na" : report.destination.result === "allowed" ? "pass" : "fail") as Mark,
        resource: (report.resource.result === "not_applicable" ? "na" : report.resource.result === "allowed" ? "pass" : "fail") as Mark,
        schema: (report.parameters.ok ? "pass" : "fail") as Mark,
        classification: (report.classification.result === "not_applicable" ? "na" : report.classification.result === "within_limit" ? "pass" : "fail") as Mark,
        data: (report.dataClasses.blocked ? "fail" : report.dataClasses.findings.length === 0 ? "pass" : "pass") as Mark,
      }
    : null;

  return (
    <Panel title="Evaluate" description="Ask the registry what would happen if this agent called this tool. Policies are not evaluated here.">
      <form onSubmit={run} className="grid gap-3 md:grid-cols-2">
        <Field label="Agent" htmlFor="eval-agent">
          <Combobox id="eval-agent" value={agentId} onChange={setAgentId} options={agents.map((a) => ({ value: a.id, label: a.name, description: `${a.slug} · ${statusLabel(a.status)}` }))} placeholder="Select an agent" searchPlaceholder="Search agents" />
        </Field>
        <Field label="Tool" htmlFor="eval-tool">
          <Select id="eval-tool" value={toolKey} onValueChange={setToolKey} options={tools.map((t) => ({ value: t.key, label: <span className="font-mono text-xs">{t.key}</span> }))} placeholder="Select a tool" />
        </Field>
        <Field label="Resource" htmlFor="eval-resource" hint="optional">
          <Combobox id="eval-resource" value={resourceKey} onChange={setResourceKey} options={resources.map((r) => ({ value: r.key, label: r.key, description: `${r.name} · ${statusLabel(r.classification)}` }))} placeholder="No resource" allowClear />
        </Field>
        <Field label="Destination domain" htmlFor="eval-dest" hint="optional; otherwise taken from parameters">
          <Input id="eval-dest" value={destination} onChange={(e) => setDestination(e.target.value)} placeholder="files.partner-upload.example" className="font-mono" maxLength={253} spellCheck={false} />
        </Field>
        <Field label="Parameters" htmlFor="eval-params" hint="JSON object" className="md:col-span-2">
          <Textarea id="eval-params" value={params} onChange={(e) => setParams(e.target.value)} rows={4} mono spellCheck={false} />
        </Field>
        <div className="flex items-center gap-3 md:col-span-2">
          <Button type="submit" variant="primary" loading={pending} disabled={!agentId || !toolKey} disabledReason={!agentId ? "Choose an agent" : "Choose a tool"}>
            <Play className="h-3.5 w-3.5" aria-hidden />
            Evaluate
          </Button>
          <FormError error={error} />
        </div>
      </form>

      {report && marks ? (
        <div className="mt-5 space-y-4" aria-live="polite" data-testid="tool-security-report">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-fg-muted">Verdict</span>
            <Badge tone={VERDICT[report.verdict].tone}>{VERDICT[report.verdict].label}</Badge>
            {report.tool ? <Badge mono>{report.tool.key}</Badge> : <Badge tone="deny">unknown tool</Badge>}
            {report.agent ? <Badge mono>{report.agent.slug}</Badge> : null}
          </div>
          <ul className="rounded-md border border-line px-3">
            <CheckRow mark={marks.grant} label="Grant" detail={report.grant.status === "granted" ? "The agent holds an active grant for this tool." : report.grant.status === "not_granted" ? "The agent has never been granted this tool." : report.grant.status === "revoked" ? "The grant was revoked." : report.grant.status === "disabled" ? "The grant is disabled." : "The tool is not registered in this organization."} />
            <CheckRow mark={marks.destination} label="Destination check" detail={report.destination.result === "not_applicable" ? (report.destination.domain ? `Destination ${report.destination.domain}: this tool has no domain allowlist.` : "No destination in the request.") : `${report.destination.domain} is ${report.destination.result === "allowed" ? "in" : "not in"} the allowlist (${report.destination.allowedDomains.join(", ") || "empty"}).`} />
            <CheckRow mark={marks.resource} label="Resource check" detail={report.resource.result === "not_applicable" ? (report.resource.key ? `Resource ${report.resource.key}: no resource restriction on this tool, or the resource is unknown.` : "No resource requested.") : `${report.resource.key} is ${report.resource.result === "allowed" ? "in" : "not in"} the allowed resources (${report.resource.allowedResourceKeys.join(", ")}).`} />
            <CheckRow mark={marks.schema} label="Schema check" detail={report.parameters.ok ? "Parameters satisfy the tool's declared schema (or the tool declares none)." : report.parameters.errors.join("; ")} />
            <CheckRow mark={marks.classification} label="Classification check" detail={report.classification.result === "not_applicable" ? "No resource to compare against the agent's limit." : `Resource is ${statusLabel(report.classification.resourceClassification)}; agent limit is ${statusLabel(report.classification.agentLimit)}.`} />
            <CheckRow mark={marks.data} label="Data classification" detail={report.dataClasses.findings.length === 0 ? "No sensitive data classes found in the parameters." : `${report.dataClasses.dataClasses.join(", ")} found${report.dataClasses.highestSeverity ? `, highest severity ${statusLabel(report.dataClasses.highestSeverity)}` : ""}${report.dataClasses.blocked ? ". Blocked." : report.dataClasses.requireApproval ? ". Approval required." : ". Rewritten before execution."}`} />
          </ul>
          {report.dataClasses.findings.length > 0 ? (
            <SimpleTable caption="Data class findings">
              <thead>
                <tr>
                  <Th>Class</Th>
                  <Th>Action</Th>
                  <Th>Field</Th>
                  <Th align="end">Matches</Th>
                  <Th>Severity</Th>
                  <Th>Masked preview</Th>
                </tr>
              </thead>
              <tbody>
                {report.dataClasses.findings.map((f) => (
                  <Tr key={`${f.field}-${f.dataClass}`}>
                    <Td mono>{f.dataClass}</Td>
                    <Td>
                      <Badge tone={dataActionTone(f.action)}>{DATA_ACTION_LABELS[f.action] ?? f.action}</Badge>
                    </Td>
                    <Td mono>{f.field}</Td>
                    <Td align="end">{f.count}</Td>
                    <Td>
                      <Badge tone={severityTone(f.severity)}>{statusLabel(f.severity)}</Badge>
                    </Td>
                    <Td mono>{f.previews.join(", ")}</Td>
                  </Tr>
                ))}
              </tbody>
            </SimpleTable>
          ) : null}
          {report.baseline.length > 0 ? (
            <div>
              <h3 className="mb-1 text-xs font-medium uppercase tracking-wide text-fg-muted">Baseline failures (as the gateway reports them)</h3>
              <ul className="space-y-1 text-xs">
                {report.baseline.map((b, i) => (
                  <li key={`${b.code}-${i}`} className="flex gap-2">
                    <Badge tone="deny" mono>
                      {b.code}
                    </Badge>
                    <span className="text-fg-muted">{b.message}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <Note>This report mirrors the gateway&apos;s own structural checks: the same function, the same inputs. A live request additionally runs policy evaluation, which can deny or require approval on top of these results.</Note>
        </div>
      ) : null}
    </Panel>
  );
}
