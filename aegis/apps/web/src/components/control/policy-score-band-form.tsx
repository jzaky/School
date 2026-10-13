"use client";
import * as React from "react";
import { CheckCircle2, XCircle } from "lucide-react";
import { DEFAULT_SCORE_BAND_TOOLS, scoreBandTemplateSchema, type ScoreBandSettings } from "@aegis/core/policy/score-band";
import { previewScoreBandTemplateAction, type ScoreBandTemplatePreview } from "@/server/actions/policies";
import { Field, FormError, Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Checkbox, Switch } from "@/components/ui/switch";
import { StatusBadge } from "@/components/ui/status";
import { Note } from "@/components/ui/note";
import { SimpleTable, Td, Th, Tr } from "@/components/ui/simple-table";
import { cn } from "@/lib/utils";
import type { RoleOption, ToolOptionLite } from "./policy-refund-form";

/** Form state. Numbers are kept as strings while the user types; the template schema coerces them. */
export interface ScoreBandFormValues {
  tools: string[];
  scoreSource: "context" | "params";
  scoreAttribute: string;
  scale: "unit" | "percent";
  reviewFrom: string;
  holdFrom: string;
  blockFrom: string;
  missingScore: "deny" | "require_approval";
  approverRoles: string[];
  minApprovers: string;
  approvalExpiresMinutes: string;
  holdExpiresMinutes: string;
  holdEscalateToRoles: string[];
  separationOfDuties: boolean;
}

export function valuesFromScoreBandSettings(s: ScoreBandSettings): ScoreBandFormValues {
  return {
    tools: s.tools,
    scoreSource: s.scoreSource,
    scoreAttribute: s.scoreAttribute,
    scale: s.scale,
    reviewFrom: String(s.reviewFrom),
    holdFrom: String(s.holdFrom),
    blockFrom: String(s.blockFrom),
    missingScore: s.missingScore,
    approverRoles: s.approverRoles,
    minApprovers: String(s.minApprovers),
    approvalExpiresMinutes: String(s.approvalExpiresMinutes),
    holdExpiresMinutes: String(s.holdExpiresMinutes),
    holdEscalateToRoles: s.holdEscalateToRoles,
    separationOfDuties: s.separationOfDuties,
  };
}

export function defaultScoreBandFormValues(): ScoreBandFormValues {
  return valuesFromScoreBandSettings(scoreBandTemplateSchema.parse({}));
}

export interface ParsedScoreBandForm {
  settings: ScoreBandSettings | null;
  errors: Record<string, string>;
}

/** Validates the form through the template schema. Field errors are keyed by the form field name. */
export function parseScoreBandForm(v: ScoreBandFormValues): ParsedScoreBandForm {
  const r = scoreBandTemplateSchema.safeParse(v);
  if (r.success) return { settings: r.data, errors: {} };
  const errors: Record<string, string> = {};
  for (const issue of r.error.issues) {
    const key = String(issue.path[0] ?? "form");
    if (!errors[key]) errors[key] = issue.message;
  }
  return { settings: null, errors };
}

const SCALE_OPTIONS = [
  { value: "unit", label: "0 to 1 (probability)" },
  { value: "percent", label: "0 to 100 (percent)" },
];
const SOURCE_OPTIONS = [
  { value: "context", label: "Request context (context.<name>)" },
  { value: "params", label: "Tool parameters (params.<name>)" },
];
const MISSING_OPTIONS = [
  { value: "deny", label: "Refuse the request" },
  { value: "require_approval", label: "Ask a person" },
];

export function ScoreBandSettingsForm({ values, onChange, errors, roles, tools, disabled, disabledReason, idPrefix = "sb" }: { values: ScoreBandFormValues; onChange: (next: ScoreBandFormValues) => void; errors: Record<string, string>; roles: RoleOption[]; tools: ToolOptionLite[]; disabled?: boolean; disabledReason?: string; idPrefix?: string }) {
  const id = (k: string) => `${idPrefix}-${k}`;
  const set = <K extends keyof ScoreBandFormValues>(k: K, v: ScoreBandFormValues[K]) => onChange({ ...values, [k]: v });
  const toggle = (list: string[], item: string, on: boolean) => (on ? [...new Set([...list, item])] : list.filter((x) => x !== item));
  const toolChoices = React.useMemo(() => {
    const keys = new Set<string>([...DEFAULT_SCORE_BAND_TOOLS, ...tools.map((t) => t.key), ...values.tools]);
    return [...keys].map((key) => ({ key, name: tools.find((t) => t.key === key)?.name ?? key }));
  }, [tools, values.tools]);
  const dis = disabled ?? false;
  const field = (name: string) => errors[name] ?? null;
  const max = values.scale === "unit" ? 1 : 100;
  const step = values.scale === "unit" ? "0.01" : "1";

  return (
    <div className="space-y-4">
      {disabled && disabledReason ? <Note>{disabledReason}</Note> : null}

      <section className="space-y-3">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-fg-muted">The score</h3>
        <p className="text-xs text-fg-muted">Your own model scores each request. The agent sends that score with the request; AEGIS never calls the model.</p>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Sent in" htmlFor={id("source")} error={field("scoreSource")}>
            <Select id={id("source")} value={values.scoreSource} onValueChange={(v) => set("scoreSource", v as ScoreBandFormValues["scoreSource"])} options={SOURCE_OPTIONS} disabled={dis} />
          </Field>
          <Field label="Field name" htmlFor={id("attr")} hint="letters, digits, underscores" error={field("scoreAttribute")}>
            <Input id={id("attr")} value={values.scoreAttribute} onChange={(e) => set("scoreAttribute", e.target.value)} disabled={dis} aria-invalid={!!field("scoreAttribute")} />
          </Field>
          <Field label="Scale" htmlFor={id("scale")} error={field("scale")}>
            <Select id={id("scale")} value={values.scale} onValueChange={(v) => set("scale", v as ScoreBandFormValues["scale"])} options={SCALE_OPTIONS} disabled={dis} />
          </Field>
        </div>
      </section>

      <section className="space-y-3">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-fg-muted">Bands</h3>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Review from" htmlFor={id("review")} hint={`below this runs automatically (0 to ${max})`} error={field("reviewFrom")}>
            <Input id={id("review")} type="number" min={0} max={max} step={step} inputMode="decimal" value={values.reviewFrom} onChange={(e) => set("reviewFrom", e.target.value)} disabled={dis} aria-invalid={!!field("reviewFrom")} />
          </Field>
          <Field label="Hold from" htmlFor={id("hold")} hint="a person decides and a hold is placed" error={field("holdFrom")}>
            <Input id={id("hold")} type="number" min={0} max={max} step={step} inputMode="decimal" value={values.holdFrom} onChange={(e) => set("holdFrom", e.target.value)} disabled={dis} aria-invalid={!!field("holdFrom")} />
          </Field>
          <Field label="Block from" htmlFor={id("block")} hint="at or above this is refused" error={field("blockFrom")}>
            <Input id={id("block")} type="number" min={0} max={max} step={step} inputMode="decimal" value={values.blockFrom} onChange={(e) => set("blockFrom", e.target.value)} disabled={dis} aria-invalid={!!field("blockFrom")} />
          </Field>
        </div>
        <Field label="When no score is sent" htmlFor={id("missing")} error={field("missingScore")}>
          <Select id={id("missing")} value={values.missingScore} onValueChange={(v) => set("missingScore", v as ScoreBandFormValues["missingScore"])} options={MISSING_OPTIONS} disabled={dis} />
        </Field>
      </section>

      <section className="space-y-3">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-fg-muted">Approval</h3>
        <div>
          <span className="mb-1 block text-xs font-medium text-fg-muted">
            Who can approve <span className="font-normal text-fg-dim">roles that can decide approvals (approvals:decide); if none is ticked, any of them may approve</span>
          </span>
          {roles.length === 0 ? (
            <Note tone="warning">No role in this organization can decide approvals (approvals:decide). Requests needing approval would wait until such a role exists.</Note>
          ) : (
            <div className="grid gap-1 sm:grid-cols-2" role="group" aria-label="Approver roles">
              {roles.map((r) => (
                <Checkbox key={r.key} id={id(`role-${r.key}`)} checked={values.approverRoles.includes(r.key)} onCheckedChange={(on) => set("approverRoles", toggle(values.approverRoles, r.key, on))} disabled={dis} label={r.name} description={`${r.memberCount} member${r.memberCount === 1 ? "" : "s"}`} />
              ))}
            </div>
          )}
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Approvers needed" htmlFor={id("min")} error={field("minApprovers")}>
            <Select id={id("min")} value={values.minApprovers} onValueChange={(v) => set("minApprovers", v)} options={[{ value: "1", label: "1 approver" }, { value: "2", label: "2 approvers" }, { value: "3", label: "3 approvers" }]} disabled={dis} />
          </Field>
          <Field label="Review band: decide within" htmlFor={id("exp")} hint="minutes" error={field("approvalExpiresMinutes")}>
            <Input id={id("exp")} type="number" min={5} max={10080} value={values.approvalExpiresMinutes} onChange={(e) => set("approvalExpiresMinutes", e.target.value)} disabled={dis} aria-invalid={!!field("approvalExpiresMinutes")} />
          </Field>
          <Field label="Hold band: decide within" htmlFor={id("hexp")} hint="minutes" error={field("holdExpiresMinutes")}>
            <Input id={id("hexp")} type="number" min={5} max={10080} value={values.holdExpiresMinutes} onChange={(e) => set("holdExpiresMinutes", e.target.value)} disabled={dis} aria-invalid={!!field("holdExpiresMinutes")} />
          </Field>
        </div>
        {roles.length ? (
          <div>
            <span className="mb-1 block text-xs font-medium text-fg-muted">
              Hold band escalates to <span className="font-normal text-fg-dim">when nobody decides in time</span>
            </span>
            <div className="grid gap-1 sm:grid-cols-2" role="group" aria-label="Escalation roles">
              {roles.map((r) => (
                <Checkbox key={r.key} id={id(`esc-${r.key}`)} checked={values.holdEscalateToRoles.includes(r.key)} onCheckedChange={(on) => set("holdEscalateToRoles", toggle(values.holdEscalateToRoles, r.key, on))} disabled={dis} label={r.name} />
              ))}
            </div>
          </div>
        ) : null}
        <label className="flex items-center justify-between gap-3 rounded-md border border-line bg-bg px-3 py-2 text-sm">
          <span>
            <span className="block text-fg">Separation of duties</span>
            <span className="block text-xs text-fg-muted">Owners of the requesting agent cannot approve its requests.</span>
          </span>
          <Switch id={id("sod")} checked={values.separationOfDuties} onCheckedChange={(v) => set("separationOfDuties", v)} disabled={dis} aria-label="Separation of duties" />
        </label>
      </section>

      <section className="space-y-3">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-fg-muted">Tools</h3>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Tools this policy applies to">
          {toolChoices.map((t) => {
            const on = values.tools.includes(t.key);
            return (
              <button key={t.key} type="button" disabled={dis} aria-pressed={on} onClick={() => set("tools", toggle(values.tools, t.key, !on))} className={cn("rounded-md border px-2 py-0.5 font-mono text-xs transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50", on ? "border-accent bg-accent/15 text-fg" : "border-line bg-bg text-fg-muted hover:text-fg")} title={t.name}>
                {t.key}
              </button>
            );
          })}
        </div>
        {field("tools") ? (
          <p role="alert" className="text-xs text-deny">
            {field("tools")}
          </p>
        ) : null}
      </section>
    </div>
  );
}

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = React.useState(value);
  React.useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/** Live outcomes of the template's sample requests against the current settings. */
export function ScoreBandSamplePreview({ settings }: { settings: ScoreBandSettings | null }) {
  const key = React.useMemo(() => (settings ? JSON.stringify(settings) : null), [settings]);
  const debounced = useDebounced(key, 250);
  const [state, setState] = React.useState<{ key: string; preview: ScoreBandTemplatePreview } | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);
  React.useEffect(() => {
    if (!debounced) return;
    let cancelled = false;
    setLoading(true);
    previewScoreBandTemplateAction(JSON.parse(debounced)).then((r) => {
      if (cancelled) return;
      setLoading(false);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setError(null);
      setState({ key: debounced, preview: r.data });
    });
    return () => {
      cancelled = true;
    };
  }, [debounced]);
  const stale = state && key !== state.key;
  return (
    <div className="space-y-2" aria-live="polite" aria-busy={loading || !!stale}>
      <FormError error={error} />
      {!state ? (
        <p className="py-4 text-center text-xs text-fg-dim">{settings ? "Computing sample outcomes" : "Fix the highlighted fields to see sample outcomes."}</p>
      ) : (
        <SimpleTable caption="Sample request outcomes" className={cn("transition-opacity", stale && "opacity-60")}>
          <thead>
            <tr>
              <Th>Request</Th>
              <Th>Outcome</Th>
              <Th>Why</Th>
            </tr>
          </thead>
          <tbody>
            {state.preview.samples.map((s) => (
              <Tr key={s.id} data-sample={s.id}>
                <Td>
                  <span className="block text-[13px] text-fg">{s.name}</span>
                  <span className="block text-xs text-fg-muted">{s.description}</span>
                </Td>
                <Td>
                  <span className="inline-flex items-center gap-1.5">
                    <StatusBadge status={s.result} />
                    {s.result === s.expected ? <CheckCircle2 className="h-3.5 w-3.5 text-allow" aria-label="as intended" /> : <XCircle className="h-3.5 w-3.5 text-deny" aria-label="not as intended" />}
                  </span>
                </Td>
                <Td className="text-xs text-fg-muted">
                  {s.decidingRule ? (
                    <>
                      <span className="font-mono text-fg">{s.decidingRule.ruleId}</span>
                      <span className="block">{s.decidingRule.reason || s.decidingRule.description}</span>
                    </>
                  ) : (
                    s.reasons.join("; ")
                  )}
                </Td>
              </Tr>
            ))}
          </tbody>
        </SimpleTable>
      )}
    </div>
  );
}
