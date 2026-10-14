"use client";
import * as React from "react";
import Link from "next/link";
import { CheckCircle2, CircleAlert, Play } from "lucide-react";
import { runSalesScenarioAction, setupSalesDemoAction, openSalesDemoAction } from "@/server/actions/commercial";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { FormError } from "@/components/ui/input";
import type { SalesRun } from "@aegis/core";

interface Scenario {
  key: string;
  title: string;
  summary: string;
  shows: string;
}

export function SalesScenarios({ scenarios, canRun }: { scenarios: Scenario[]; canRun: boolean }) {
  const [runs, setRuns] = React.useState<Record<string, SalesRun>>({});
  const [pending, setPending] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {scenarios.map((s, i) => {
        const run = runs[s.key];
        return (
          <section key={s.key} className="rounded-panel border border-line bg-bg-elev p-4" data-testid="sales-scenario" data-scenario={s.key}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-fg">
                  {i + 1}. {s.title}
                </h2>
                <p className="mt-1 text-sm text-fg-muted">{s.summary}</p>
              </div>
              <Badge tone="approval">Simulated</Badge>
            </div>
            <div className="mt-3 flex items-center justify-between gap-2">
              <span className="text-xs text-fg-dim">Shows: {s.shows}</span>
              <Button
                size="sm"
                variant={run ? "secondary" : "primary"}
                loading={pending === s.key}
                disabled={!canRun || (pending !== null && pending !== s.key)}
                disabledReason={!canRun ? "Requires gateway:read" : "Another scenario is running"}
                data-testid="run-scenario"
                onClick={async () => {
                  setPending(s.key);
                  setError(null);
                  const r = await runSalesScenarioAction(s.key);
                  setPending(null);
                  if (!r.ok) return setError(r.error);
                  setRuns((x) => ({ ...x, [s.key]: r.data }));
                }}
              >
                <Play className="h-3.5 w-3.5" aria-hidden />
                {run ? "Run again" : "Run"}
              </Button>
            </div>
            {run ? (
              <ol className="mt-3 space-y-2 border-t border-line pt-3" data-testid="sales-steps">
                {run.steps.map((st, j) => (
                  <li key={j} className="flex items-start gap-2 text-sm" data-expected={st.expected ? "yes" : "no"}>
                    {st.expected ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-allow" aria-label="As expected" /> : <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-deny" aria-label="Not as expected" />}
                    <span className="min-w-0">
                      <span className="block font-medium text-fg">{st.title}</span>
                      <span className="block text-xs text-fg-muted">{st.detail}</span>
                      <span className="block text-xs text-fg">
                        {st.outcome}
                        {st.requestId ? (
                          <>
                            {" "}
                            <Link href={`/gateway/${st.requestId}`} className="text-accent hover:underline">
                              Open the record
                            </Link>
                          </>
                        ) : null}
                      </span>
                    </span>
                  </li>
                ))}
              </ol>
            ) : null}
          </section>
        );
      })}
      <FormError error={error} />
    </div>
  );
}

export function SalesDemoSetup({ exists, allowed, reason }: { exists: boolean; allowed: boolean; reason: string }) {
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  return (
    <div className="space-y-2">
      <Button
        variant="primary"
        loading={pending}
        disabled={!exists && !allowed}
        disabledReason={reason}
        data-testid="sales-demo-setup"
        onClick={async () => {
          setPending(true);
          setError(null);
          const r = exists ? await openSalesDemoAction() : await setupSalesDemoAction();
          setPending(false);
          if (r && !r.ok) setError(r.error);
        }}
      >
        {exists ? "Open my sales demonstration" : "Create my sales demonstration"}
      </Button>
      <FormError error={error} />
    </div>
  );
}
