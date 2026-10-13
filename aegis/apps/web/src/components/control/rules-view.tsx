import * as React from "react";
import type { Condition, PolicyDocument, Rule } from "@aegis/core/policy/schema";
import { Badge } from "@/components/ui/badge";
import { Panel } from "@/components/ui/panel";
import { statusTone } from "@/lib/status";
import { EFFECT_LABEL } from "./policy-templates";

function showValue(v: unknown): string {
  if (v === undefined) return "";
  if (typeof v === "string") return v;
  return JSON.stringify(v);
}

export function ConditionTree({ cond, depth = 0 }: { cond: Condition; depth?: number }) {
  if ("always" in cond) return <Badge tone={cond.always ? "allow" : "deny"}>always {String(cond.always)}</Badge>;
  if ("attr" in cond) {
    return (
      <span className="inline-flex flex-wrap items-center gap-1 rounded-md border border-line bg-bg px-1.5 py-1 font-mono text-[11px]">
        <span className="text-fg">{cond.attr}</span>
        <span className="rounded bg-bg-elev-2 px-1 text-accent">{cond.op}</span>
        {cond.value !== undefined ? <span className="text-fg-muted">{showValue(cond.value)}</span> : null}
      </span>
    );
  }
  const kind = "all" in cond ? "all" : "any" in cond ? "any" : "not";
  const children = "all" in cond ? cond.all : "any" in cond ? cond.any : [cond.not];
  const label = kind === "all" ? "ALL of" : kind === "any" ? "ANY of" : "NOT";
  return (
    <div className={depth > 0 ? "ms-3 border-s border-line-strong ps-3" : ""}>
      <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-fg-muted">{label}</div>
      <div className="flex flex-col gap-1.5">
        {children.map((ch, i) => (
          <div key={i}>
            <ConditionTree cond={ch} depth={depth + 1} />
          </div>
        ))}
      </div>
    </div>
  );
}

export function RuleCard({ rule, index, decidingId }: { rule: Rule; index: number; decidingId?: string | null }) {
  const deciding = decidingId === rule.id;
  return (
    <Panel className={deciding ? "border-accent" : undefined} padded>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs tabular text-fg-dim">#{index + 1}</span>
            <span className="font-mono text-sm text-fg">{rule.id}</span>
            <Badge tone={statusTone(rule.effect)}>{EFFECT_LABEL[rule.effect] ?? rule.effect}</Badge>
            {rule.securityEventSeverity ? <Badge tone={statusTone(rule.securityEventSeverity)}>security event: {rule.securityEventSeverity}</Badge> : null}
            {deciding ? <Badge tone="info">deciding rule</Badge> : null}
          </div>
          {rule.description ? <p className="mt-1 text-xs text-fg-muted">{rule.description}</p> : null}
        </div>
        {rule.riskIndicators.length ? (
          <div className="flex flex-wrap gap-1">
            {rule.riskIndicators.map((r) => (
              <Badge key={r} tone="approval" mono>
                {r}
              </Badge>
            ))}
          </div>
        ) : null}
      </div>
      <div className="mt-3">
        <ConditionTree cond={rule.when} />
      </div>
      {rule.reason ? (
        <p className="mt-3 text-xs text-fg">
          <span className="text-fg-dim">Reason returned: </span>
          {rule.reason}
        </p>
      ) : null}
      {rule.approval ? (
        <div className="mt-3 grid gap-x-6 gap-y-1 rounded-md border border-approval/30 bg-approval/5 px-3 py-2 text-xs sm:grid-cols-2">
          <div>
            <span className="text-fg-dim">Approver roles: </span>
            {rule.approval.roles.length ? rule.approval.roles.join(", ") : "anyone with approvals:decide"}
          </div>
          <div>
            <span className="text-fg-dim">Approvers needed: </span>
            {rule.approval.minApprovers}
          </div>
          <div>
            <span className="text-fg-dim">Expires in: </span>
            {rule.approval.expiresInMinutes} minutes
          </div>
          <div>
            <span className="text-fg-dim">Owners cannot approve their own agent (separation of duties): </span>
            {rule.approval.separationOfDuties ? "on" : "off"}
          </div>
          {rule.approval.escalateToRoles.length ? (
            <div>
              <span className="text-fg-dim">Escalate to: </span>
              {rule.approval.escalateToRoles.join(", ")}
            </div>
          ) : null}
          {rule.approval.instructions ? <div className="sm:col-span-2 text-fg-muted">{rule.approval.instructions}</div> : null}
        </div>
      ) : null}
    </Panel>
  );
}

export function RulesView({ doc }: { doc: PolicyDocument }) {
  const scope = doc.appliesTo;
  const scoped = scope.tools.length || scope.actions.length || scope.environments.length;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-xs text-fg-muted">
        <span className="font-medium text-fg">Applies to:</span>
        {scoped ? (
          <>
            {scope.tools.map((t) => (
              <Badge key={`t-${t}`} mono>
                tool {t}
              </Badge>
            ))}
            {scope.actions.map((t) => (
              <Badge key={`a-${t}`} mono>
                action {t}
              </Badge>
            ))}
            {scope.environments.map((t) => (
              <Badge key={`e-${t}`} tone={statusTone(t)}>
                {t}
              </Badge>
            ))}
          </>
        ) : (
          <span>every tool, action and environment</span>
        )}
        <span className="ms-auto">How rules combine: every rule is checked; a deny wins over require approval, which wins over allow. If nothing matches, the request is denied.</span>
      </div>
      {doc.rules.map((r, i) => (
        <RuleCard key={r.id} rule={r} index={i} />
      ))}
      <div className="rounded-md border border-dashed border-line px-3 py-2 text-xs text-fg-muted">
        <Badge tone="deny">Deny</Badge> <span className="ms-2">Default when no rule matches.</span>
        {doc.tests.length ? <span className="ms-3 text-fg-dim">{doc.tests.length} built-in test case{doc.tests.length === 1 ? "" : "s"} run when the version is submitted for review.</span> : <span className="ms-3 text-fg-dim">No built-in test cases.</span>}
      </div>
    </div>
  );
}
