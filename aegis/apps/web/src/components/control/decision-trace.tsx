import * as React from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/ui/status";
import { SimpleTable, Td, Th, Tr } from "@/components/ui/simple-table";
import { Note } from "@/components/ui/note";
import { statusTone } from "@/lib/status";
import { EFFECT_LABEL } from "./policy-templates";

interface TraceRule {
  policyKey: string;
  policyVersionId: string;
  policyVersion: number;
  ruleId: string;
  effect: string;
  matched: boolean;
  description?: string;
  comparisons: { attr: string; op: string; expected: unknown; actual: unknown; result: boolean }[];
}

export interface Explanation {
  stage?: string;
  decidingRule?: { policy: string; rule: string; effect: string } | null;
  defaultDeny?: boolean;
  policiesEvaluated?: { key: string; version: number }[];
  skipped?: { policyKey: string; reason: string }[];
  trace?: TraceRule[];
  failures?: { code: string; message: string }[];
  shield?: unknown[];
  error?: string;
  inputSummary?: Record<string, unknown>;
}

const show = (v: unknown) => (v === undefined ? "undefined" : typeof v === "string" ? v : JSON.stringify(v));

/** Server-renderable decision explanation: result, deciding rule, baseline failures and the per-comparison trace. */
export function DecisionPanel({ result, explanation, reasons, policyVersionIds, policyLinks, latencyMs }: { result: string; explanation: Explanation; reasons: string[]; policyVersionIds: string[]; policyLinks: Map<string, { policyId: string; key: string; version: number }>; latencyMs: number }) {
  const trace = explanation.trace ?? [];
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <StatusBadge status={result} className="text-sm" />
        {explanation.stage ? <Badge>stage: {explanation.stage}</Badge> : null}
        {explanation.defaultDeny ? <Badge tone="deny">default deny</Badge> : null}
        <span className="text-xs tabular text-fg-dim">{latencyMs} ms</span>
        {explanation.decidingRule ? (
          <span className="text-sm">
            Deciding rule <span className="font-mono">{explanation.decidingRule.policy}/{explanation.decidingRule.rule}</span>
          </span>
        ) : null}
      </div>
      {reasons.length ? (
        <ul className="list-inside list-disc text-xs text-fg-muted">
          {reasons.map((r, i) => (
            <li key={i}>{r}</li>
          ))}
        </ul>
      ) : null}
      {explanation.failures?.length ? (
        <Note tone="danger">
          <strong>Basic safety checks failed before any policy was consulted:</strong>
          <ul className="mt-1 list-inside list-disc">
            {explanation.failures.map((f, i) => (
              <li key={i}>
                <span className="font-mono">{f.code}</span>: {f.message}
              </li>
            ))}
          </ul>
        </Note>
      ) : null}
      {explanation.error ? <Note tone="danger">The policy check itself hit an error, so the request was denied to be safe (fail closed): {explanation.error}</Note> : null}
      {policyVersionIds.length ? (
        <div className="flex flex-wrap items-center gap-1 text-xs text-fg-muted">
          <span>Policy versions:</span>
          {policyVersionIds.map((id) => {
            const p = policyLinks.get(id);
            return p ? (
              <Link key={id} href={`/policies/${p.policyId}?v=${id}&tab=rules`} className="text-accent hover:underline">
                <Badge mono>
                  {p.key} v{p.version}
                </Badge>
              </Link>
            ) : (
              <Badge key={id} mono>
                {id.slice(0, 8)}
              </Badge>
            );
          })}
        </div>
      ) : null}
      {explanation.skipped?.length ? <p className="text-xs text-fg-dim">Not applied because this request is outside their scope: {explanation.skipped.map((s) => `${s.policyKey} (${s.reason})`).join("; ")}</p> : null}
      {trace.length ? (
        <SimpleTable caption="Decision trace">
          <thead>
            <tr>
              <Th>Policy</Th>
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
            {trace.flatMap((t) => {
              const rows = t.comparisons.length ? t.comparisons : [null];
              return rows.map((cmp, i) => (
                <Tr key={`${t.policyKey}-${t.ruleId}-${i}`} className={t.matched ? "bg-bg-elev-2/40" : undefined}>
                  <Td mono>{i === 0 ? `${t.policyKey} v${t.policyVersion}` : ""}</Td>
                  <Td mono>{i === 0 ? t.ruleId : ""}</Td>
                  <Td>{i === 0 ? <Badge tone={statusTone(t.effect)}>{EFFECT_LABEL[t.effect] ?? t.effect}</Badge> : null}</Td>
                  {cmp ? (
                    <>
                      <Td mono>{cmp.attr}</Td>
                      <Td mono>{cmp.op}</Td>
                      <Td mono className="max-w-[180px] truncate" title={show(cmp.expected)}>
                        {show(cmp.expected)}
                      </Td>
                      <Td mono className="max-w-[180px] truncate" title={show(cmp.actual)}>
                        {show(cmp.actual)}
                      </Td>
                    </>
                  ) : (
                    <Td colSpan={4} className="text-fg-dim">
                      no comparisons (always)
                    </Td>
                  )}
                  <Td>
                    {cmp ? <span className={cmp.result ? "text-allow" : "text-fg-dim"}>{cmp.result ? "true" : "false"}</span> : null}
                    {i === rows.length - 1 ? (
                      <Badge className="ms-2" tone={t.matched ? "allow" : "neutral"}>
                        {t.matched ? "matched" : "not matched"}
                      </Badge>
                    ) : null}
                  </Td>
                </Tr>
              ));
            })}
          </tbody>
        </SimpleTable>
      ) : explanation.stage === "policy" ? (
        <p className="text-xs text-fg-dim">No policy covers this request, so it was denied by default.</p>
      ) : null}
    </div>
  );
}
