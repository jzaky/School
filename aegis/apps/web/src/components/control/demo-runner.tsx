"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowUpRight, CheckCircle2, Play, XCircle } from "lucide-react";
import { runDemoAction, type DemoRunOutput } from "@/server/actions/demos";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/ui/panel";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Note } from "@/components/ui/note";
import { cn } from "@/lib/utils";

export interface Scenario {
  id: "banking" | "refunds" | "sensitive-data";
  title: string;
  agent: string;
  summary: string;
  steps: string[];
}

export const SCENARIOS: Scenario[] = [
  {
    id: "banking",
    title: "Banking: transfer limits with human approval",
    agent: "Treasury Transfer Agent",
    summary: "Three simulated transfers against the treasury-transfer-limits policy.",
    steps: ["AED 12,500 transfer within autonomous authority executes through the simulated core banking system", "AED 250,000 transfer requires a manager; nothing executes until an approver decides", "AED 1,500,000 transfer is denied outright and raises a security event"],
  },
  {
    id: "refunds",
    title: "Refunds: tiers, duplicates, expiry and tampering",
    agent: "Customer Support Refund Agent",
    summary: "Six requests exercising the refund-authority policy and the gateway's integrity checks.",
    steps: ["AED 180 refund executes autonomously", "A duplicate idempotency key returns the original outcome without a second execution", "AED 1,450 refund requires a supervisor", "AED 6,200 refund is denied", "An approval left to expire cannot be used afterwards", "Replaying an approved request with a changed amount is rejected"],
  },
  {
    id: "sensitive-data",
    title: "Sensitive data: egress and exfiltration attempts",
    agent: "Marketing Outreach Agent",
    summary: "Approved campaign email, then two attempts to move customer data outside the allowlist.",
    steps: ["Campaign email to an approved domain executes", "Export of customer records to an external destination is denied by the allowlist and policy", "Email containing card and IBAN data to an external domain is denied"],
  },
];

export function DemoRunner({ canDecide, userName, enabled = true }: { canDecide: boolean; userName: string; enabled?: boolean }) {
  const router = useRouter();
  const [autoApprove, setAutoApprove] = React.useState(false);
  const [running, setRunning] = React.useState<string | null>(null);
  const [runs, setRuns] = React.useState<Record<string, DemoRunOutput>>({});
  const [errors, setErrors] = React.useState<Record<string, string>>({});

  async function run(id: Scenario["id"]) {
    setRunning(id);
    setErrors((e) => ({ ...e, [id]: "" }));
    const r = await runDemoAction({ scenario: id, autoApprove });
    setRunning(null);
    if (!r.ok) {
      setErrors((e) => ({ ...e, [id]: r.error }));
      toast.error(r.error);
      return;
    }
    setRuns((x) => ({ ...x, [id]: r.data }));
    toast.success(`${r.data.steps.length} steps ran through the gateway`);
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <Panel>
        <div className="flex flex-wrap items-center gap-3">
          <Switch id="auto-approve" checked={autoApprove} onCheckedChange={setAutoApprove} disabled={!canDecide} aria-label="Auto-approve as the signed-in user" />
          <label htmlFor="auto-approve" className={cn("text-sm", !canDecide && "opacity-60")}>
            {autoApprove ? `Auto-approve as ${userName}` : "Leave approvals pending for the Approval Center"}
          </label>
          {!canDecide ? <Badge>Auto-approve requires approvals:decide</Badge> : null}
          <span className="ms-auto text-xs text-fg-muted">{autoApprove ? "Approvals are decided in your name and executed immediately." : "Approval requests stay open for a human to decide."}</span>
        </div>
      </Panel>
      <div className="grid gap-4 xl:grid-cols-3">
        {SCENARIOS.map((s) => {
          const run0 = runs[s.id];
          return (
            <Panel
              key={s.id}
              title={s.title}
              description={`${s.agent}. ${s.summary}`}
              actions={
                <Button variant="primary" size="sm" loading={running === s.id} disabled={running !== null || !enabled} disabledReason={!enabled ? "Demo mode is off for this organization" : "Another scenario is running"} onClick={() => run(s.id)}>
                  <Play className="h-3.5 w-3.5" aria-hidden />
                  Run
                </Button>
              }
            >
              {!run0 ? (
                <ol className="list-inside list-decimal space-y-1 text-xs text-fg-muted">
                  {s.steps.map((st) => (
                    <li key={st}>{st}</li>
                  ))}
                </ol>
              ) : (
                <ol className="relative ms-1 border-s border-line" aria-label={`${s.title} results`}>
                  {run0.steps.map((st, i) => {
                    const approvalId = st.requestId ? run0.approvals[st.requestId] : undefined;
                    return (
                      <li key={i} className="relative ps-5 pb-3 last:pb-0">
                        <span className={cn("absolute -start-[7px] top-0.5 grid h-3.5 w-3.5 place-items-center rounded-full ring-4 ring-bg-elev", st.ok ? "bg-allow" : "bg-deny")}>{st.ok ? <CheckCircle2 className="h-3 w-3 text-bg" aria-hidden /> : <XCircle className="h-3 w-3 text-bg" aria-hidden />}</span>
                        <div className="text-sm text-fg">{st.title}</div>
                        <div className="text-xs text-fg-muted">{st.detail}</div>
                        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
                          <Badge tone={/denied|refused|rejected|expired/i.test(st.outcome) ? "deny" : /executed|approved|allowed/i.test(st.outcome) ? "allow" : /approval|pending/i.test(st.outcome) ? "approval" : "neutral"}>{st.outcome}</Badge>
                          {st.requestId ? (
                            <Link href={`/gateway/${st.requestId}`} className="inline-flex items-center gap-0.5 text-accent hover:underline">
                              request <ArrowUpRight className="h-3 w-3" aria-hidden />
                            </Link>
                          ) : null}
                          {approvalId ? (
                            <Link href={`/approvals/${approvalId}`} className="inline-flex items-center gap-0.5 text-accent hover:underline">
                              approval <ArrowUpRight className="h-3 w-3" aria-hidden />
                            </Link>
                          ) : null}
                        </div>
                      </li>
                    );
                  })}
                </ol>
              )}
              {run0 ? (
                <p className="mt-3 font-mono text-[11px] text-fg-dim">
                  correlation {run0.correlationId} · {new Date(run0.finishedAt).getTime() - new Date(run0.startedAt).getTime()} ms
                </p>
              ) : null}
              {errors[s.id] ? <Note tone="danger" className="mt-3">{errors[s.id]}</Note> : null}
            </Panel>
          );
        })}
      </div>
    </div>
  );
}
