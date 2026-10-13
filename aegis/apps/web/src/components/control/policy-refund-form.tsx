"use client";
import * as React from "react";
import { CheckCircle2, Play, XCircle } from "lucide-react";
import { afterHoursSample, businessHourSample, DEFAULT_REFUND_TOOLS, formatRefundAmount, refundCurrencies, refundTemplateSchema, type RefundTemplateSettings } from "@aegis/core/policy/templates";
import type { PolicyDocument } from "@aegis/core/policy/schema";
import { previewRefundTemplateAction, simulatePolicyAction, type RefundTemplatePreview, type SimulationOutput } from "@/server/actions/policies";
import { Button } from "@/components/ui/button";
import { Field, FormError, Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Checkbox, Switch } from "@/components/ui/switch";
import { Tooltip } from "@/components/ui/tooltip";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/ui/status";
import { Panel } from "@/components/ui/panel";
import { Note } from "@/components/ui/note";
import { SimpleTable, Td, Th, Tr } from "@/components/ui/simple-table";
import { cn } from "@/lib/utils";

export interface RoleOption {
  key: string;
  name: string;
  description: string;
  memberCount: number;
}

export interface ToolOptionLite {
  key: string;
  name: string;
}

/** Form state. Numbers are kept as strings while the user types; the template schema coerces them. */
export interface RefundFormValues {
  tools: string[];
  currency: string;
  allowedCurrencies: string[];
  autoApproveBelow: string;
  approvalUpTo: string;
  approverRoles: string[];
  minApprovers: string;
  approvalExpiresMinutes: string;
  separationOfDuties: boolean;
  blockDuplicates: boolean;
  duplicateHandling: "deny" | "require_approval";
  requireReason: boolean;
  businessHoursEnabled: boolean;
  startHourUtc: string;
  endHourUtc: string;
  maxDailyDeniedAttempts: string;
}

export const CURRENCY_OPTIONS = ["AED", "SAR", "QAR", "KWD", "BHD", "OMR", "USD", "EUR", "GBP", "EGP", "INR"];

export function valuesFromSettings(s: RefundTemplateSettings): RefundFormValues {
  return {
    tools: s.tools,
    currency: s.currency,
    allowedCurrencies: s.allowedCurrencies.filter((c) => c !== s.currency),
    autoApproveBelow: String(s.autoApproveBelow),
    approvalUpTo: String(s.approvalUpTo),
    approverRoles: s.approverRoles,
    minApprovers: String(s.minApprovers),
    approvalExpiresMinutes: String(s.approvalExpiresMinutes),
    separationOfDuties: s.separationOfDuties,
    blockDuplicates: s.blockDuplicates,
    duplicateHandling: s.duplicateHandling,
    requireReason: s.requireReason,
    businessHoursEnabled: s.businessHoursOnly.enabled,
    startHourUtc: String(s.businessHoursOnly.startHourUtc),
    endHourUtc: String(s.businessHoursOnly.endHourUtc),
    maxDailyDeniedAttempts: String(s.maxDailyDeniedAttempts),
  };
}

export function defaultRefundFormValues(): RefundFormValues {
  return valuesFromSettings(refundTemplateSchema.parse({}));
}

export interface ParsedRefundForm {
  settings: RefundTemplateSettings | null;
  errors: Record<string, string>;
}

/** Validates the form through the template schema. Field errors are keyed by the form field name. */
export function parseRefundForm(v: RefundFormValues): ParsedRefundForm {
  const r = refundTemplateSchema.safeParse({
    tools: v.tools,
    currency: v.currency,
    allowedCurrencies: v.allowedCurrencies,
    autoApproveBelow: v.autoApproveBelow,
    approvalUpTo: v.approvalUpTo,
    approverRoles: v.approverRoles,
    minApprovers: v.minApprovers,
    approvalExpiresMinutes: v.approvalExpiresMinutes,
    separationOfDuties: v.separationOfDuties,
    blockDuplicates: v.blockDuplicates,
    duplicateHandling: v.duplicateHandling,
    requireReason: v.requireReason,
    businessHoursOnly: { enabled: v.businessHoursEnabled, startHourUtc: v.startHourUtc, endHourUtc: v.endHourUtc },
    maxDailyDeniedAttempts: v.maxDailyDeniedAttempts,
  });
  if (r.success) return { settings: r.data, errors: {} };
  const errors: Record<string, string> = {};
  for (const issue of r.error.issues) {
    const key = issue.path[0] === "businessHoursOnly" ? String(issue.path[1] ?? "businessHoursOnly") : String(issue.path[0] ?? "form");
    if (!errors[key]) errors[key] = issue.message.replace(/^Expected number, received nan$/i, "Enter a number");
  }
  return { settings: null, errors };
}

const HOURS = Array.from({ length: 24 }, (_, h) => ({ value: String(h), label: `${String(h).padStart(2, "0")}:00` }));

function GuardedSwitch({ id, checked, onCheckedChange, disabled, disabledReason, label }: { id: string; checked: boolean; onCheckedChange: (v: boolean) => void; disabled?: boolean; disabledReason?: string; label: string }) {
  const sw = <Switch id={id} checked={checked} onCheckedChange={onCheckedChange} disabled={disabled} aria-label={label} />;
  if (disabled && disabledReason) {
    return (
      <Tooltip content={disabledReason}>
        <span className="inline-flex" tabIndex={0}>
          {sw}
        </span>
      </Tooltip>
    );
  }
  return sw;
}

function ToggleRow({ id, label, description, checked, onCheckedChange, disabled, disabledReason, children }: { id: string; label: string; description: string; checked: boolean; onCheckedChange: (v: boolean) => void; disabled?: boolean; disabledReason?: string; children?: React.ReactNode }) {
  return (
    <div className="rounded-md border border-line px-3 py-2">
      <div className="flex items-start justify-between gap-3">
        <label htmlFor={id} className="min-w-0 cursor-pointer">
          <span className="block text-sm text-fg">{label}</span>
          <span className="block text-xs text-fg-muted">{description}</span>
        </label>
        <GuardedSwitch id={id} checked={checked} onCheckedChange={onCheckedChange} disabled={disabled} disabledReason={disabledReason} label={label} />
      </div>
      {checked && children ? <div className="mt-2 border-t border-line pt-2">{children}</div> : null}
    </div>
  );
}

export function RefundSettingsForm({ values, onChange, errors, roles, tools, disabled, disabledReason, idPrefix = "rf" }: { values: RefundFormValues; onChange: (next: RefundFormValues) => void; errors: Record<string, string>; roles: RoleOption[]; tools: ToolOptionLite[]; disabled?: boolean; disabledReason?: string; idPrefix?: string }) {
  const id = (k: string) => `${idPrefix}-${k}`;
  const set = <K extends keyof RefundFormValues>(k: K, v: RefundFormValues[K]) => onChange({ ...values, [k]: v });
  const [customTool, setCustomTool] = React.useState("");
  const toolChoices = React.useMemo(() => {
    const keys = new Set<string>([...DEFAULT_REFUND_TOOLS, ...tools.filter((t) => /refund|payment/i.test(t.key)).map((t) => t.key), ...values.tools]);
    return [...keys].map((key) => ({ key, name: tools.find((t) => t.key === key)?.name ?? (key === "refund-payment" ? "Refund payment (Stripe)" : key === "issue-refund" ? "Issue refund" : key) }));
  }, [tools, values.tools]);
  const toggle = (list: string[], item: string, on: boolean) => (on ? [...new Set([...list, item])] : list.filter((x) => x !== item));
  const currencyOptions = React.useMemo(() => (CURRENCY_OPTIONS.includes(values.currency) ? CURRENCY_OPTIONS : [values.currency, ...CURRENCY_OPTIONS]).map((c) => ({ value: c, label: c })), [values.currency]);
  const dis = disabled ?? false;
  const field = (name: string) => errors[name] ?? null;

  return (
    <div className="space-y-4">
      {disabled && disabledReason ? <Note>{disabledReason}</Note> : null}

      <section className="space-y-3">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-fg-muted">Amount bands</h3>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Currency" htmlFor={id("currency")} hint="thresholds are in this currency" error={field("currency")}>
            <Select id={id("currency")} value={values.currency} onValueChange={(c) => set("currency", c)} options={currencyOptions} disabled={dis} />
          </Field>
          <Field label="Run automatically below" htmlFor={id("auto")} hint={values.currency} error={field("autoApproveBelow")}>
            <Input id={id("auto")} type="number" min={0} step="any" inputMode="decimal" value={values.autoApproveBelow} onChange={(e) => set("autoApproveBelow", e.target.value)} disabled={dis} aria-invalid={!!field("autoApproveBelow")} />
          </Field>
          <Field label="Needs approval up to" htmlFor={id("upto")} hint="above this is refused" error={field("approvalUpTo")}>
            <Input id={id("upto")} type="number" min={0} step="any" inputMode="decimal" value={values.approvalUpTo} onChange={(e) => set("approvalUpTo", e.target.value)} disabled={dis} aria-invalid={!!field("approvalUpTo")} />
          </Field>
        </div>
        <div>
          <span className="mb-1 block text-xs font-medium text-fg-muted">
            Also accept <span className="font-normal text-fg-dim">the same limits apply to these currencies; amounts are not converted</span>
          </span>
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Additional accepted currencies">
            {CURRENCY_OPTIONS.filter((c) => c !== values.currency).map((c) => {
              const on = values.allowedCurrencies.includes(c);
              return (
                <button key={c} type="button" disabled={dis} aria-pressed={on} onClick={() => set("allowedCurrencies", toggle(values.allowedCurrencies, c, !on))} className={cn("rounded-md border px-2 py-0.5 font-mono text-xs transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50", on ? "border-accent bg-accent/15 text-fg" : "border-line bg-bg text-fg-muted hover:text-fg")}>
                  {c}
                </button>
              );
            })}
          </div>
          {field("allowedCurrencies") ? (
            <p role="alert" className="mt-1 text-xs text-deny">
              {field("allowedCurrencies")}
            </p>
          ) : null}
        </div>
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
          {values.approverRoles.filter((k) => !roles.some((r) => r.key === k)).length ? <p className="mt-1 text-xs text-approval">Roles not found in this organization: {values.approverRoles.filter((k) => !roles.some((r) => r.key === k)).join(", ")}</p> : null}
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Approvers needed" htmlFor={id("min")} error={field("minApprovers")}>
            <Select id={id("min")} value={values.minApprovers} onValueChange={(v) => set("minApprovers", v)} options={[{ value: "1", label: "1 approver" }, { value: "2", label: "2 approvers" }, { value: "3", label: "3 approvers" }]} disabled={dis} />
          </Field>
          <Field label="Decide within" htmlFor={id("exp")} hint="minutes" error={field("approvalExpiresMinutes")}>
            <Input id={id("exp")} type="number" min={5} max={10080} value={values.approvalExpiresMinutes} onChange={(e) => set("approvalExpiresMinutes", e.target.value)} disabled={dis} aria-invalid={!!field("approvalExpiresMinutes")} />
          </Field>
          <div className="flex items-end pb-1">
            <Checkbox id={id("sod")} checked={values.separationOfDuties} onCheckedChange={(v) => set("separationOfDuties", v)} disabled={dis} label="Separation of duties" description="Owners of the requesting agent cannot approve its refunds" />
          </div>
        </div>
      </section>

      <section className="space-y-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-fg-muted">Safeguards</h3>
        <ToggleRow id={id("dup")} label="Block duplicate refunds" description="Same order or payment already refunded, or awaiting a decision, in the last 30 days" checked={values.blockDuplicates} onCheckedChange={(v) => set("blockDuplicates", v)} disabled={dis} disabledReason={disabledReason}>
          <Field label="When a duplicate is detected" htmlFor={id("duph")}>
            <Select id={id("duph")} value={values.duplicateHandling} onValueChange={(v) => set("duplicateHandling", v as RefundFormValues["duplicateHandling"])} options={[{ value: "deny", label: "Refuse it" }, { value: "require_approval", label: "Ask a human, whatever the amount" }]} disabled={dis} />
          </Field>
        </ToggleRow>
        <ToggleRow id={id("reason")} label="Require a reason" description="Refuse refunds whose reason is missing or blank" checked={values.requireReason} onCheckedChange={(v) => set("requireReason", v)} disabled={dis} disabledReason={disabledReason} />
        <ToggleRow id={id("hours")} label="Business hours only" description="Outside the window every refund needs approval" checked={values.businessHoursEnabled} onCheckedChange={(v) => set("businessHoursEnabled", v)} disabled={dis} disabledReason={disabledReason}>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="From" htmlFor={id("start")} hint="UTC" error={field("startHourUtc")}>
              <Select id={id("start")} value={values.startHourUtc} onValueChange={(v) => set("startHourUtc", v)} options={HOURS} disabled={dis} />
            </Field>
            <Field label="Until" htmlFor={id("end")} hint="UTC; the window ends at the start of this hour" error={field("endHourUtc")}>
              <Select id={id("end")} value={values.endHourUtc} onValueChange={(v) => set("endHourUtc", v)} options={HOURS} disabled={dis} />
            </Field>
          </div>
        </ToggleRow>
        <Field label="Stop after refused attempts in 24 hours" htmlFor={id("denied")} hint="0 switches the check off" error={field("maxDailyDeniedAttempts")}>
          <Input id={id("denied")} type="number" min={0} max={10000} value={values.maxDailyDeniedAttempts} onChange={(e) => set("maxDailyDeniedAttempts", e.target.value)} disabled={dis} className="sm:max-w-[160px]" aria-invalid={!!field("maxDailyDeniedAttempts")} />
        </Field>
      </section>

      <section className="space-y-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-fg-muted">Tools</h3>
        <div className="grid gap-1 sm:grid-cols-2" role="group" aria-label="Refund tools">
          {toolChoices.map((t) => (
            <Checkbox key={t.key} id={id(`tool-${t.key}`)} checked={values.tools.includes(t.key)} onCheckedChange={(on) => set("tools", toggle(values.tools, t.key, on))} disabled={dis} label={t.name} description={t.key} />
          ))}
        </div>
        <div className="flex items-end gap-2">
          <Field label="Add another tool key" htmlFor={id("tool-add")} className="flex-1">
            <Input id={id("tool-add")} value={customTool} onChange={(e) => setCustomTool(e.target.value)} placeholder="refund-wallet" className="font-mono" disabled={dis} />
          </Field>
          <Button
            size="md"
            disabled={dis || !/^[a-z0-9][a-z0-9-]*$/.test(customTool.trim())}
            disabledReason={dis ? disabledReason : "Enter a tool key in lowercase letters, digits and hyphens"}
            onClick={() => {
              set("tools", toggle(values.tools, customTool.trim(), true));
              setCustomTool("");
            }}
          >
            Add
          </Button>
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

export function RefundExplanation({ lines, className }: { lines: string[]; className?: string }) {
  return (
    <ul className={cn("space-y-1.5 text-sm text-fg", className)} aria-label="What this policy does">
      {lines.map((l, i) => (
        <li key={i} className="flex gap-2">
          <span aria-hidden className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
          <span>{l}</span>
        </li>
      ))}
    </ul>
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
export function RefundSamplePreview({ settings, onPreview }: { settings: RefundTemplateSettings | null; onPreview?: (p: RefundTemplatePreview | null) => void }) {
  const key = React.useMemo(() => (settings ? JSON.stringify(settings) : null), [settings]);
  const debounced = useDebounced(key, 250);
  const [state, setState] = React.useState<{ key: string; preview: RefundTemplatePreview } | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);
  React.useEffect(() => {
    if (!debounced) return;
    let cancelled = false;
    setLoading(true);
    previewRefundTemplateAction(JSON.parse(debounced)).then((r) => {
      if (cancelled) return;
      setLoading(false);
      if (!r.ok) {
        setError(r.error);
        onPreview?.(null);
        return;
      }
      setError(null);
      setState({ key: debounced, preview: r.data });
      onPreview?.(r.data);
    });
    return () => {
      cancelled = true;
    };
    // onPreview is a callback identity we deliberately do not track.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

/**
 * "Try a request": a plain-language tester for refund policies. Runs the simulator against either an
 * unsaved document (the guided form's current output) or a stored version.
 */
export function RefundTester({ settings, document, versionId, idPrefix = "rt", title = "Try a request", description }: { settings: RefundTemplateSettings; document?: PolicyDocument | null; versionId?: string; idPrefix?: string; title?: string; description?: string }) {
  const id = (k: string) => `${idPrefix}-${k}`;
  const currencies = refundCurrencies(settings);
  const sampleMid = settings.approvalUpTo > settings.autoApproveBelow ? Math.round(settings.autoApproveBelow + (settings.approvalUpTo - settings.autoApproveBelow) / 2) : settings.approvalUpTo;
  const [amount, setAmount] = React.useState(String(sampleMid || 100));
  const [currency, setCurrency] = React.useState(settings.currency);
  const [orderId, setOrderId] = React.useState("ORD-24117");
  const [reason, setReason] = React.useState("Customer returned the item");
  const [duplicate, setDuplicate] = React.useState(false);
  const [afterHours, setAfterHours] = React.useState(false);
  const [tool, setTool] = React.useState(settings.tools[0] ?? "issue-refund");
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [result, setResult] = React.useState<SimulationOutput | null>(null);
  React.useEffect(() => {
    if (!settings.tools.includes(tool)) setTool(settings.tools[0] ?? "issue-refund");
  }, [settings.tools, tool]);
  const amountValid = amount.trim() !== "" && Number.isFinite(Number(amount));
  const hasTarget = !!document || !!versionId;
  const currencyOptions = [...new Set([...currencies, ...CURRENCY_OPTIONS])].map((c) => ({ value: c, label: currencies.includes(c) ? c : `${c} (not accepted)` }));

  async function run(e: React.FormEvent) {
    e.preventDefault();
    if (!hasTarget) return;
    setPending(true);
    setError(null);
    const params: Record<string, unknown> = { orderId: orderId.trim() || undefined, customerId: "CUST-88213", amount: Number(amount), currency };
    if (reason.trim()) params.reason = reason.trim();
    const r = await simulatePolicyAction({
      ...(document ? { document } : { versionId }),
      tool,
      action: "execute",
      params,
      hour: afterHours ? afterHoursSample(settings) : businessHourSample(settings),
      priorRequestsSameReference: duplicate ? 1 : 0,
    });
    setPending(false);
    if (!r.ok) return setError(r.error);
    setResult(r.data);
  }

  const hoursOff = !settings.businessHoursOnly.enabled;
  return (
    <Panel title={title} description={description ?? "Enter a refund the way the agent would request it and see what the policy decides. Nothing is recorded."} data-testid={id("panel")}>
      <form onSubmit={run} className="grid gap-4 lg:grid-cols-5">
        <div className="space-y-3 lg:col-span-2">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Amount" htmlFor={id("amount")} error={amountValid || amount === "" ? null : "Enter a number"}>
              <Input id={id("amount")} type="number" min={0} step="any" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} required />
            </Field>
            <Field label="Currency" htmlFor={id("currency")}>
              <Select id={id("currency")} value={currency} onValueChange={setCurrency} options={currencyOptions} />
            </Field>
            <Field label="Order id" htmlFor={id("order")} hint="the business reference for the order">
              <Input id={id("order")} value={orderId} onChange={(e) => setOrderId(e.target.value)} className="font-mono" />
            </Field>
            <Field label="Reason" htmlFor={id("reason")} hint="clear it to see what happens when no reason is given">
              <Input id={id("reason")} value={reason} onChange={(e) => setReason(e.target.value)} />
            </Field>
            {settings.tools.length > 1 ? (
              <Field label="Tool" htmlFor={id("tool")} className="sm:col-span-2">
                <Select id={id("tool")} value={tool} onValueChange={setTool} options={settings.tools.map((t) => ({ value: t, label: t }))} />
              </Field>
            ) : null}
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-3 rounded-md border border-line px-3 py-2">
              <label htmlFor={id("dup")} className="text-sm text-fg">
                Already refunded once
                <span className="block text-xs text-fg-muted">An earlier request for this order exists</span>
              </label>
              <GuardedSwitch id={id("dup")} checked={duplicate} onCheckedChange={setDuplicate} label="Already refunded once" />
            </div>
            <div className="flex items-center justify-between gap-3 rounded-md border border-line px-3 py-2">
              <label htmlFor={id("hours")} className="text-sm text-fg">
                Outside business hours
                <span className="block text-xs text-fg-muted">{hoursOff ? "This policy has no business-hours rule" : `Requested outside ${String(settings.businessHoursOnly.startHourUtc).padStart(2, "0")}:00 to ${String(settings.businessHoursOnly.endHourUtc).padStart(2, "0")}:00 UTC`}</span>
              </label>
              <GuardedSwitch id={id("hours")} checked={afterHours && !hoursOff} onCheckedChange={setAfterHours} disabled={hoursOff} disabledReason="Enable business hours in the policy to test this" label="Outside business hours" />
            </div>
          </div>
          <FormError error={error} />
          <Button type="submit" variant="primary" loading={pending} disabled={!amountValid || !hasTarget} disabledReason={!hasTarget ? "Fix the thresholds first" : "Enter an amount"}>
            <Play className="h-3.5 w-3.5" aria-hidden />
            Check this refund
          </Button>
        </div>
        <div className="lg:col-span-3" aria-live="polite">
          {!result ? (
            <div className="flex h-full min-h-[160px] items-center justify-center rounded-md border border-dashed border-line px-4 text-center text-xs text-fg-dim">The decision, the rule that made it and the reason the agent would receive appear here.</div>
          ) : (
            <div className="space-y-3 rounded-md border border-line bg-bg p-4" data-testid={id("result")}>
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge status={result.result} className="text-sm" />
                <span className="text-sm text-fg-muted">
                  for {formatRefundAmount(Number(amount), currency)} on <span className="font-mono text-fg">{orderId || "(no order)"}</span>
                </span>
              </div>
              {result.decidingRule ? (
                <div className="text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs text-fg-dim">Decided by</span>
                    <Badge mono>{result.decidingRule.ruleId}</Badge>
                  </div>
                  <p className="mt-1 text-fg">{result.decidingRule.description}</p>
                  {result.decidingRule.reason ? <p className="mt-1 text-xs text-fg-muted">Reason returned to the agent: {result.decidingRule.reason}</p> : null}
                </div>
              ) : (
                <p className="text-sm text-fg-muted">No rule matched, so the request is denied by default.</p>
              )}
              {result.skipped.length ? <Note>The policy did not apply: {result.skipped.map((s) => s.reason).join("; ")}.</Note> : null}
              {result.riskIndicators.length ? (
                <div className="flex flex-wrap gap-1">
                  {result.riskIndicators.map((r) => (
                    <Badge key={r} tone="approval" mono>
                      {r}
                    </Badge>
                  ))}
                </div>
              ) : null}
            </div>
          )}
        </div>
      </form>
    </Panel>
  );
}
