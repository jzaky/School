"use client";
import * as React from "react";
import { Play } from "lucide-react";
import { simulatePolicyAction, type SimulationOutput } from "@/server/actions/policies";
import { Button } from "@/components/ui/button";
import { Field, FormError, Input, Textarea } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Combobox } from "@/components/ui/combobox";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/ui/status";
import { Panel } from "@/components/ui/panel";
import { Note } from "@/components/ui/note";
import { SimpleTable, Td, Th, Tr } from "@/components/ui/simple-table";
import { CodeBlock } from "@/components/ui/code-block";
import { statusTone } from "@/lib/status";
import { EFFECT_LABEL } from "./policy-templates";

export interface SimAgent {
  id: string;
  name: string;
  slug: string;
}
export interface SimTool {
  key: string;
  name: string;
}

export function PolicySimulator({ versionId, versionLabel, tools, agents, defaultTool, defaultParams }: { versionId: string; versionLabel: string; tools: SimTool[]; agents: SimAgent[]; defaultTool: string; defaultParams: string }) {
  const [tool, setTool] = React.useState(defaultTool);
  const [action, setAction] = React.useState("execute");
  const [agentId, setAgentId] = React.useState<string | null>(null);
  const [resource, setResource] = React.useState("");
  const [params, setParams] = React.useState(defaultParams);
  const [hour, setHour] = React.useState("");
  const [denied, setDenied] = React.useState("0");
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [result, setResult] = React.useState<SimulationOutput | null>(null);
  let paramsValid = true;
  try {
    JSON.parse(params || "{}");
  } catch {
    paramsValid = false;
  }

  async function run(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const r = await simulatePolicyAction({ versionId, tool, action, agentId, resource: resource || undefined, params: params || "{}", hour: hour === "" ? undefined : hour, deniedCount24h: denied === "" ? undefined : denied });
    setPending(false);
    if (!r.ok) return setError(r.error);
    setResult(r.data);
  }

  return (
    <div className="grid gap-4 xl:grid-cols-5">
      <Panel title="Scenario" description={`Dry run against ${versionLabel}. Nothing is recorded.`} className="xl:col-span-2">
        <form onSubmit={run} className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Tool" htmlFor="sim-tool">
              <Input id="sim-tool" list="sim-tools" value={tool} onChange={(e) => setTool(e.target.value)} className="font-mono" required />
              <datalist id="sim-tools">
                {tools.map((t) => (
                  <option key={t.key} value={t.key}>
                    {t.name}
                  </option>
                ))}
              </datalist>
            </Field>
            <Field label="Action" htmlFor="sim-action">
              <Input id="sim-action" value={action} onChange={(e) => setAction(e.target.value)} className="font-mono" />
            </Field>
            <Field label="Agent" htmlFor="sim-agent" hint="attributes come from the registry">
              <Combobox id="sim-agent" value={agentId} onChange={setAgentId} options={agents.map((a) => ({ value: a.id, label: a.name, description: a.slug }))} placeholder="Generic active agent" allowClear />
            </Field>
            <Field label="Resource key" htmlFor="sim-resource">
              <Input id="sim-resource" value={resource} onChange={(e) => setResource(e.target.value)} placeholder="payments-core" className="font-mono" />
            </Field>
            <Field label="Hour (UTC)" htmlFor="sim-hour" hint="context.hour">
              <Input id="sim-hour" type="number" min={0} max={23} value={hour} onChange={(e) => setHour(e.target.value)} placeholder="now" />
            </Field>
            <Field label="Denied in 24h" htmlFor="sim-denied" hint="context.deniedCount24h">
              <Input id="sim-denied" type="number" min={0} value={denied} onChange={(e) => setDenied(e.target.value)} />
            </Field>
          </div>
          <Field label="Parameters (JSON)" htmlFor="sim-params" error={paramsValid ? null : "Invalid JSON"}>
            <Textarea id="sim-params" mono value={params} onChange={(e) => setParams(e.target.value)} className="min-h-[120px]" spellCheck={false} />
          </Field>
          <FormError error={error} />
          <Button type="submit" variant="primary" loading={pending} disabled={!paramsValid || !tool.trim()} disabledReason="Tool and valid JSON parameters are required">
            <Play className="h-3.5 w-3.5" aria-hidden />
            Simulate
          </Button>
        </form>
      </Panel>
      <div className="space-y-4 xl:col-span-3">
        {!result ? (
          <Panel>
            <p className="py-8 text-center text-xs text-fg-dim">Run a scenario to see the decision, the deciding rule and the full comparison trace.</p>
          </Panel>
        ) : (
          <>
            <Panel title="Decision">
              <div className="flex flex-wrap items-center gap-3">
                <StatusBadge status={result.result} className="text-sm" />
                {result.defaultDeny ? <Badge>default deny</Badge> : null}
                {result.decidingRule ? (
                  <span className="text-sm">
                    Deciding rule <span className="font-mono">{result.decidingRule.ruleId}</span>
                    {result.decidingRule.description ? <span className="text-fg-muted">: {result.decidingRule.description}</span> : null}
                  </span>
                ) : (
                  <span className="text-sm text-fg-muted">No rule matched</span>
                )}
              </div>
              {result.reasons.length ? (
                <ul className="mt-2 list-inside list-disc text-xs text-fg-muted">
                  {result.reasons.map((r, i) => (
                    <li key={i}>{r}</li>
                  ))}
                </ul>
              ) : null}
              {result.riskIndicators.length ? (
                <div className="mt-2 flex flex-wrap gap-1">
                  {result.riskIndicators.map((r) => (
                    <Badge key={r} tone="approval" mono>
                      {r}
                    </Badge>
                  ))}
                </div>
              ) : null}
              {result.skipped.length ? <Note className="mt-3">Policy skipped: {result.skipped.map((s) => s.reason).join("; ")}. The scope in appliesTo did not match this input, so the result is the default deny.</Note> : null}
            </Panel>
            <Panel title="Trace" description="Every rule and comparison is evaluated; nothing short-circuits." padded={false}>
              <SimpleTable caption="Evaluation trace" className="rounded-none border-0">
                <thead>
                  <tr>
                    <Th>Rule</Th>
                    <Th>Effect</Th>
                    <Th>Attribute</Th>
                    <Th>Operator</Th>
                    <Th>Expected</Th>
                    <Th>Actual</Th>
                    <Th>Result</Th>
                  </tr>
                </thead>
                <tbody>
                  {result.trace.flatMap((t) =>
                    t.comparisons.length === 0
                      ? [
                          <Tr key={t.ruleId} className={t.matched ? "bg-bg-elev-2/40" : undefined}>
                            <Td mono>{t.ruleId}</Td>
                            <Td>
                              <Badge tone={statusTone(t.effect)}>{EFFECT_LABEL[t.effect] ?? t.effect}</Badge>
                            </Td>
                            <Td colSpan={4} className="text-fg-dim">
                              no comparisons (always)
                            </Td>
                            <Td>
                              <Badge tone={t.matched ? "allow" : "neutral"}>{t.matched ? "matched" : "not matched"}</Badge>
                            </Td>
                          </Tr>,
                        ]
                      : t.comparisons.map((cmp, i) => (
                          <Tr key={`${t.ruleId}-${i}`} className={t.matched ? "bg-bg-elev-2/40" : undefined}>
                            <Td mono>{i === 0 ? t.ruleId : ""}</Td>
                            <Td>{i === 0 ? <Badge tone={statusTone(t.effect)}>{EFFECT_LABEL[t.effect] ?? t.effect}</Badge> : null}</Td>
                            <Td mono>{cmp.attr}</Td>
                            <Td mono>{cmp.op}</Td>
                            <Td mono className="max-w-[200px] truncate" title={cmp.expected}>
                              {cmp.expected}
                            </Td>
                            <Td mono className="max-w-[200px] truncate" title={cmp.actual}>
                              {cmp.actual}
                            </Td>
                            <Td>
                              <span className={cmp.result ? "text-allow" : "text-fg-dim"}>{cmp.result ? "true" : "false"}</span>
                              {i === t.comparisons.length - 1 ? <Badge className="ms-2" tone={t.matched ? "allow" : "neutral"}>{t.matched ? "rule matched" : "rule not matched"}</Badge> : null}
                            </Td>
                          </Tr>
                        )),
                  )}
                </tbody>
              </SimpleTable>
            </Panel>
            <Panel title="Input document" description="What the evaluator saw">
              <CodeBlock code={JSON.stringify(result.input, null, 2)} className="max-h-72 overflow-auto" />
            </Panel>
          </>
        )}
      </div>
    </div>
  );
}
