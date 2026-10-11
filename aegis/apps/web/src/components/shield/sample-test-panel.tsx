"use client";
import * as React from "react";
import { FlaskConical } from "lucide-react";
import { testSampleAction, type SampleTestResult } from "@/server/actions/shield";
import { Panel } from "@/components/ui/panel";
import { Button } from "@/components/ui/button";
import { Field, FormError, Textarea } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { CodeBlock } from "@/components/ui/code-block";
import { SimpleTable, Td, Th, Tr } from "@/components/ui/simple-table";
import { statusLabel } from "@/lib/status";
import { DATA_ACTION_LABELS, dataActionTone, severityTone } from "./format";

const NONE = "__none__";
const EXAMPLE = "Please refund card 4111 1111 1111 1111 for customer sara@example.com, IBAN AE070331234567890123456.";

export function SampleTestPanel({ tools }: { tools: { key: string; name: string }[] }) {
  const [text, setText] = React.useState(EXAMPLE);
  const [toolKey, setToolKey] = React.useState(NONE);
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [result, setResult] = React.useState<SampleTestResult | null>(null);

  async function run(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const r = await testSampleAction({ text, toolKey: toolKey === NONE ? undefined : toolKey });
    setPending(false);
    if (!r.ok) return setError(r.error);
    setResult(r.data);
  }

  return (
    <Panel title="Test a sample" description="Dry run of the inspector with this organization's enabled classes. Nothing is stored and no event is raised.">
      <form onSubmit={run} className="space-y-3">
        <Field label="Sample text" htmlFor="sample-text">
          <Textarea id="sample-text" value={text} onChange={(e) => setText(e.target.value)} maxLength={20_000} rows={4} mono />
        </Field>
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Tool" htmlFor="sample-tool" hint="optional: places the sample in the tool's first string parameter" className="min-w-[260px]">
            <Select id="sample-tool" value={toolKey} onValueChange={setToolKey} options={[{ value: NONE, label: "Generic field (sample)" }, ...tools.map((t) => ({ value: t.key, label: <span className="font-mono text-xs">{t.key}</span> }))]} />
          </Field>
          <Button type="submit" variant="primary" loading={pending} disabled={text.trim().length === 0} disabledReason="Enter a sample">
            <FlaskConical className="h-3.5 w-3.5" aria-hidden />
            Run inspector
          </Button>
        </div>
        <FormError error={error} />
      </form>
      {result ? (
        <div className="mt-4 space-y-3" aria-live="polite">
          <div className="flex flex-wrap items-center gap-2 text-xs text-fg-muted">
            <span>Verdict</span>
            {result.blocked ? <Badge tone="deny">Blocked: {result.blockedClasses.join(", ")}</Badge> : result.requireApproval ? <Badge tone="approval">Approval required</Badge> : result.findings.length ? <Badge tone="info">Rewritten and allowed</Badge> : <Badge tone="allow">No sensitive data found</Badge>}
            {result.highestSeverity ? <Badge tone={severityTone(result.highestSeverity)}>Highest severity {statusLabel(result.highestSeverity)}</Badge> : null}
            <span>
              Field <span className="font-mono text-fg">{result.field}</span>, {result.classesLoaded} enabled classes
            </span>
          </div>
          {result.findings.length > 0 ? (
            <SimpleTable caption="Findings">
              <thead>
                <tr>
                  <Th>Class</Th>
                  <Th>Action</Th>
                  <Th>Field</Th>
                  <Th align="end">Matches</Th>
                  <Th>Masked preview</Th>
                  <Th>Notes</Th>
                </tr>
              </thead>
              <tbody>
                {result.findings.map((f) => (
                  <Tr key={`${f.field}-${f.dataClass}`}>
                    <Td mono>{f.dataClass}</Td>
                    <Td>
                      <Badge tone={dataActionTone(f.action)}>{DATA_ACTION_LABELS[f.action] ?? f.action}</Badge>
                      {!f.applied ? <span className="ms-1 text-xs text-fg-dim">(not applied)</span> : null}
                    </Td>
                    <Td mono>{f.field}</Td>
                    <Td align="end">{f.count}</Td>
                    <Td mono>{f.previews.join(", ")}</Td>
                    <Td className="text-xs text-fg-muted">{f.notes.join("; ") || ""}</Td>
                  </Tr>
                ))}
              </tbody>
            </SimpleTable>
          ) : null}
          <CodeBlock label={result.blocked ? "Value as the gateway would see it (blocked before rewriting)" : "Rewritten value"} code={result.rewritten} wrap />
        </div>
      ) : null}
    </Panel>
  );
}
