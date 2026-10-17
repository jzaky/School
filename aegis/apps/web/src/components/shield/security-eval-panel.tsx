import * as React from "react";
import { ChevronDown } from "lucide-react";
import { runDetectionEval, SECURITY_EVAL_CORPUS, type EvalSummary } from "@aegis/core";
import { Panel } from "@/components/ui/panel";
import { StatPanel } from "@/components/ui/stat-panel";
import { Badge } from "@/components/ui/badge";
import { Note } from "@/components/ui/note";
import { SimpleTable, Td, Th, Tr } from "@/components/ui/simple-table";

function outcomeFor(c: (typeof SECURITY_EVAL_CORPUS)[number], s: EvalSummary): { ok: boolean; label: string } {
  if (c.kind === "injection") {
    const missed = s.injection.missed.includes(c.id);
    const cov = s.signalCoverage.find((x) => x.id === c.id);
    return { ok: !missed, label: missed ? "missed" : `flagged: ${cov?.raised.join(", ") ?? ""}` };
  }
  if (c.kind === "benign") {
    const falseSignal = s.benign.falseSignalIds.includes(c.id);
    const failure = s.pii.failures.find((f) => f.id === c.id);
    return { ok: !falseSignal && !failure, label: falseSignal ? "false signal" : failure ? failure.reason : "clean" };
  }
  const failure = s.pii.failures.find((f) => f.id === c.id);
  return { ok: !failure, label: failure ? failure.reason : "as expected" };
}

/** Pure corpus run; the figures describe the fixtures, not production traffic. Server component. */
export function SecurityEvalPanel() {
  const summary = runDetectionEval();
  const rows = SECURITY_EVAL_CORPUS.map((c) => ({ c, o: outcomeFor(c, summary) }));
  const passed = rows.filter((r) => r.o.ok).length;
  return (
    <Panel title="Security evaluation" description={`Deterministic run of the ${SECURITY_EVAL_CORPUS.length} case corpus shipped with this build, using the default class definitions.`}>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatPanel label="Injection recall" value={`${summary.injection.flagged}/${summary.injection.total}`} tone={summary.injection.missed.length === 0 ? "allow" : "approval"} footer={`${Math.round(summary.injection.recall * 100)}% of injection fixtures raised a signal`} />
        <StatPanel label="Benign false blocks" value={summary.benign.falseBlocks} tone={summary.benign.falseBlocks === 0 ? "allow" : "deny"} footer={`of ${summary.benign.total} benign fixtures`} />
        <StatPanel label="Benign false signals" value={summary.benign.falseSignals} tone={summary.benign.falseSignals === 0 ? "allow" : "approval"} footer="heuristic signals on benign text" />
        <StatPanel label="Data class cases" value={`${summary.pii.correct}/${summary.pii.total}`} tone={summary.pii.failures.length === 0 ? "allow" : "deny"} footer="detected, rewritten or blocked as expected" />
      </div>
      <Note className="mt-3">These are corpus figures: they measure the detectors against fixed fixtures, not against this organization&apos;s traffic. Injection detection is a heuristic signal and is never the enforcement path.</Note>
      <details className="group mt-3">
        <summary className="flex cursor-pointer select-none items-center gap-2 text-sm text-fg-muted hover:text-fg">
          <ChevronDown className="h-3.5 w-3.5 transition-transform duration-150 group-open:rotate-180" aria-hidden />
          Per-case results ({passed} of {rows.length} as expected)
        </summary>
        <div className="mt-3">
          <SimpleTable caption="Evaluation corpus cases">
            <thead>
              <tr>
                <Th>Case</Th>
                <Th>Kind</Th>
                <Th>Description</Th>
                <Th>Outcome</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ c, o }) => (
                <Tr key={c.id}>
                  <Td mono>{c.id}</Td>
                  <Td>
                    <Badge tone={c.kind === "injection" ? "critical" : c.kind === "benign" ? "neutral" : "info"}>{c.kind}</Badge>
                  </Td>
                  <Td className="max-w-[420px] truncate">{c.description}</Td>
                  <Td>
                    <span className={o.ok ? "text-allow" : "text-deny"}>{o.ok ? "pass" : "fail"}</span>
                    <span className="ms-2 font-mono text-xs text-fg-muted">{o.label}</span>
                  </Td>
                </Tr>
              ))}
            </tbody>
          </SimpleTable>
        </div>
      </details>
    </Panel>
  );
}
