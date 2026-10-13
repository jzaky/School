"use client";
import * as React from "react";
import { CheckCircle2, XCircle } from "lucide-react";
import { DEFAULT_TRADING_TOOLS, ORDER_SIDES, ORDER_TYPES, tradingTemplateSchema, type TradingTemplateSettings } from "@aegis/core/policy/trading";
import { previewTradingTemplateAction, type TradingTemplatePreview } from "@/server/actions/policies";
import { Field, FormError, Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Checkbox, Switch } from "@/components/ui/switch";
import { StatusBadge } from "@/components/ui/status";
import { Note } from "@/components/ui/note";
import { SimpleTable, Td, Th, Tr } from "@/components/ui/simple-table";
import { cn } from "@/lib/utils";
import type { RoleOption, ToolOptionLite } from "./policy-refund-form";

/** Form state. Numbers are kept as strings while the user types; the template schema coerces them. */
export interface TradingFormValues {
  tools: string[];
  currency: string;
  /** Comma or space separated symbols as typed. */
  instrumentsText: string;
  allowedSides: ("buy" | "sell")[];
  allowedOrderTypes: ("market" | "limit")[];
  maxOrderQty: string;
  autoApproveNotionalBelow: string;
  approvalNotionalUpTo: string;
  approverRoles: string[];
  minApprovers: string;
  approvalExpiresMinutes: string;
  separationOfDuties: boolean;
  blockDuplicates: boolean;
  requireReason: boolean;
  marketHoursEnabled: boolean;
  marketStartHourUtc: string;
  marketEndHourUtc: string;
  marketHoursHandling: "deny" | "require_approval";
  maxDailyLoss: string;
  maxDailyOrders: string;
}

export function valuesFromTradingSettings(s: TradingTemplateSettings): TradingFormValues {
  return {
    tools: s.tools,
    currency: s.currency,
    instrumentsText: s.instruments.join(", "),
    allowedSides: s.allowedSides,
    allowedOrderTypes: s.allowedOrderTypes,
    maxOrderQty: String(s.maxOrderQty),
    autoApproveNotionalBelow: String(s.autoApproveNotionalBelow),
    approvalNotionalUpTo: String(s.approvalNotionalUpTo),
    approverRoles: s.approverRoles,
    minApprovers: String(s.minApprovers),
    approvalExpiresMinutes: String(s.approvalExpiresMinutes),
    separationOfDuties: s.separationOfDuties,
    blockDuplicates: s.blockDuplicates,
    requireReason: s.requireReason,
    marketHoursEnabled: s.marketHoursOnly.enabled,
    marketStartHourUtc: String(s.marketHoursOnly.startHourUtc),
    marketEndHourUtc: String(s.marketHoursOnly.endHourUtc),
    marketHoursHandling: s.marketHoursOnly.handling,
    maxDailyLoss: String(s.maxDailyLoss),
    maxDailyOrders: String(s.maxDailyOrders),
  };
}

export function defaultTradingFormValues(): TradingFormValues {
  return valuesFromTradingSettings(tradingTemplateSchema.parse({}));
}

export interface ParsedTradingForm {
  settings: TradingTemplateSettings | null;
  errors: Record<string, string>;
}

function instrumentsFromText(text: string): string[] {
  return text
    .split(/[\s,;]+/)
    .map((x) => x.trim())
    .filter(Boolean);
}

/** Validates the form through the template schema. Field errors are keyed by the form field name. */
export function parseTradingForm(v: TradingFormValues): ParsedTradingForm {
  const r = tradingTemplateSchema.safeParse({
    tools: v.tools,
    currency: v.currency,
    instruments: instrumentsFromText(v.instrumentsText),
    allowedSides: v.allowedSides,
    allowedOrderTypes: v.allowedOrderTypes,
    maxOrderQty: v.maxOrderQty,
    autoApproveNotionalBelow: v.autoApproveNotionalBelow,
    approvalNotionalUpTo: v.approvalNotionalUpTo,
    approverRoles: v.approverRoles,
    minApprovers: v.minApprovers,
    approvalExpiresMinutes: v.approvalExpiresMinutes,
    separationOfDuties: v.separationOfDuties,
    blockDuplicates: v.blockDuplicates,
    requireReason: v.requireReason,
    marketHoursOnly: { enabled: v.marketHoursEnabled, startHourUtc: v.marketStartHourUtc, endHourUtc: v.marketEndHourUtc, handling: v.marketHoursHandling },
    maxDailyLoss: v.maxDailyLoss,
    maxDailyOrders: v.maxDailyOrders,
  });
  if (r.success) return { settings: r.data, errors: {} };
  const errors: Record<string, string> = {};
  for (const issue of r.error.issues) {
    const head = String(issue.path[0] ?? "form");
    const key = head === "instruments" ? "instrumentsText" : head === "marketHoursOnly" ? (issue.path[1] === "startHourUtc" ? "marketStartHourUtc" : issue.path[1] === "endHourUtc" ? "marketEndHourUtc" : "marketHoursEnabled") : head;
    if (!errors[key]) errors[key] = issue.message;
  }
  return { settings: null, errors };
}

const HANDLING_OPTIONS = [
  { value: "require_approval", label: "A person decides" },
  { value: "deny", label: "Refuse the order" },
];

export function TradingSettingsForm({ values, onChange, errors, roles, tools, disabled, disabledReason, idPrefix = "tr" }: { values: TradingFormValues; onChange: (next: TradingFormValues) => void; errors: Record<string, string>; roles: RoleOption[]; tools: ToolOptionLite[]; disabled?: boolean; disabledReason?: string; idPrefix?: string }) {
  const id = (k: string) => `${idPrefix}-${k}`;
  const set = <K extends keyof TradingFormValues>(k: K, v: TradingFormValues[K]) => onChange({ ...values, [k]: v });
  const toggle = <T extends string>(list: T[], item: T, on: boolean): T[] => (on ? [...new Set([...list, item])] : list.filter((x) => x !== item));
  const toolChoices = React.useMemo(() => {
    const keys = new Set<string>([...DEFAULT_TRADING_TOOLS, ...tools.map((t) => t.key), ...values.tools]);
    return [...keys].map((key) => ({ key, name: tools.find((t) => t.key === key)?.name ?? key }));
  }, [tools, values.tools]);
  const dis = disabled ?? false;
  const field = (name: string) => errors[name] ?? null;

  return (
    <div className="space-y-4">
      {disabled && disabledReason ? <Note>{disabledReason}</Note> : null}

      <section className="space-y-3">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-fg-muted">What may be traded</h3>
        <Field label="Instruments" htmlFor={id("instruments")} hint="symbols separated by commas; anything else is refused" error={field("instrumentsText")}>
          <Input id={id("instruments")} value={values.instrumentsText} onChange={(e) => set("instrumentsText", e.target.value)} disabled={dis} aria-invalid={!!field("instrumentsText")} className="font-mono uppercase" placeholder="SPY, AAPL, MSFT" />
        </Field>
        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <span className="mb-1 block text-xs font-medium text-fg-muted">Sides</span>
            <div className="grid gap-1" role="group" aria-label="Allowed sides">
              {ORDER_SIDES.map((s) => (
                <Checkbox key={s} id={id(`side-${s}`)} checked={values.allowedSides.includes(s)} onCheckedChange={(on) => set("allowedSides", toggle(values.allowedSides, s, on))} disabled={dis} label={s === "buy" ? "Buy" : "Sell"} />
              ))}
            </div>
            {field("allowedSides") ? <p role="alert" className="mt-1 text-xs text-deny">{field("allowedSides")}</p> : null}
          </div>
          <div>
            <span className="mb-1 block text-xs font-medium text-fg-muted">Order types</span>
            <div className="grid gap-1" role="group" aria-label="Allowed order types">
              {ORDER_TYPES.map((t) => (
                <Checkbox key={t} id={id(`type-${t}`)} checked={values.allowedOrderTypes.includes(t)} onCheckedChange={(on) => set("allowedOrderTypes", toggle(values.allowedOrderTypes, t, on))} disabled={dis} label={t === "market" ? "Market" : "Limit"} />
              ))}
            </div>
            {field("allowedOrderTypes") ? <p role="alert" className="mt-1 text-xs text-deny">{field("allowedOrderTypes")}</p> : null}
          </div>
          <Field label="Max units per order" htmlFor={id("maxqty")} hint="above this is refused" error={field("maxOrderQty")}>
            <Input id={id("maxqty")} type="number" min={1} step="1" inputMode="numeric" value={values.maxOrderQty} onChange={(e) => set("maxOrderQty", e.target.value)} disabled={dis} aria-invalid={!!field("maxOrderQty")} />
          </Field>
        </div>
      </section>

      <section className="space-y-3">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-fg-muted">Order value bands</h3>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Currency" htmlFor={id("currency")} error={field("currency")}>
            <Input id={id("currency")} value={values.currency} onChange={(e) => set("currency", e.target.value.toUpperCase())} maxLength={3} disabled={dis} className="font-mono uppercase" aria-invalid={!!field("currency")} />
          </Field>
          <Field label="Runs automatically below" htmlFor={id("auto")} hint="0 means every order needs a person" error={field("autoApproveNotionalBelow")}>
            <Input id={id("auto")} type="number" min={0} step="0.01" inputMode="decimal" value={values.autoApproveNotionalBelow} onChange={(e) => set("autoApproveNotionalBelow", e.target.value)} disabled={dis} aria-invalid={!!field("autoApproveNotionalBelow")} />
          </Field>
          <Field label="Approval up to" htmlFor={id("ceiling")} hint="above this is refused" error={field("approvalNotionalUpTo")}>
            <Input id={id("ceiling")} type="number" min={0} step="0.01" inputMode="decimal" value={values.approvalNotionalUpTo} onChange={(e) => set("approvalNotionalUpTo", e.target.value)} disabled={dis} aria-invalid={!!field("approvalNotionalUpTo")} />
          </Field>
        </div>
        <p className="text-xs text-fg-muted">The order value is the notional the agent declares with each order. The Alpaca paper connector refuses a limit order whose notional is not quantity times the limit price, and submits market orders by notional, so the declared value is what the broker fills.</p>
      </section>

      <section className="space-y-3">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-fg-muted">Guards</h3>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Daily loss cap" htmlFor={id("loss")} hint="0 disables; uses context.dayPnl sent by the agent" error={field("maxDailyLoss")}>
            <Input id={id("loss")} type="number" min={0} step="0.01" inputMode="decimal" value={values.maxDailyLoss} onChange={(e) => set("maxDailyLoss", e.target.value)} disabled={dis} aria-invalid={!!field("maxDailyLoss")} />
          </Field>
          <Field label="Max requests in 24 hours" htmlFor={id("rate")} hint="0 disables" error={field("maxDailyOrders")}>
            <Input id={id("rate")} type="number" min={0} step="1" inputMode="numeric" value={values.maxDailyOrders} onChange={(e) => set("maxDailyOrders", e.target.value)} disabled={dis} aria-invalid={!!field("maxDailyOrders")} />
          </Field>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="flex items-center justify-between gap-3 rounded-md border border-line bg-bg px-3 py-2 text-sm">
            <span>
              <span className="block text-fg">Refuse duplicate references</span>
              <span className="block text-xs text-fg-muted">A second order with the same reference in 30 days is refused.</span>
            </span>
            <Switch id={id("dup")} checked={values.blockDuplicates} onCheckedChange={(v) => set("blockDuplicates", v)} disabled={dis} aria-label="Refuse duplicate references" />
          </label>
          <label className="flex items-center justify-between gap-3 rounded-md border border-line bg-bg px-3 py-2 text-sm">
            <span>
              <span className="block text-fg">Require a reason</span>
              <span className="block text-xs text-fg-muted">Orders without params.reason are refused.</span>
            </span>
            <Switch id={id("reason")} checked={values.requireReason} onCheckedChange={(v) => set("requireReason", v)} disabled={dis} aria-label="Require a reason" />
          </label>
        </div>
        <label className="flex items-center justify-between gap-3 rounded-md border border-line bg-bg px-3 py-2 text-sm">
          <span>
            <span className="block text-fg">Market hours only</span>
            <span className="block text-xs text-fg-muted">Outside the window an order waits for a person or is refused. Hours are UTC, to the hour.</span>
          </span>
          <Switch id={id("hours")} checked={values.marketHoursEnabled} onCheckedChange={(v) => set("marketHoursEnabled", v)} disabled={dis} aria-label="Market hours only" />
        </label>
        {values.marketHoursEnabled ? (
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="From (UTC hour)" htmlFor={id("start")} error={field("marketStartHourUtc")}>
              <Input id={id("start")} type="number" min={0} max={23} step="1" value={values.marketStartHourUtc} onChange={(e) => set("marketStartHourUtc", e.target.value)} disabled={dis} aria-invalid={!!field("marketStartHourUtc")} />
            </Field>
            <Field label="To (UTC hour)" htmlFor={id("end")} error={field("marketEndHourUtc")}>
              <Input id={id("end")} type="number" min={0} max={23} step="1" value={values.marketEndHourUtc} onChange={(e) => set("marketEndHourUtc", e.target.value)} disabled={dis} aria-invalid={!!field("marketEndHourUtc")} />
            </Field>
            <Field label="Outside the window" htmlFor={id("handling")} error={field("marketHoursHandling")}>
              <Select id={id("handling")} value={values.marketHoursHandling} onValueChange={(v) => set("marketHoursHandling", v as TradingFormValues["marketHoursHandling"])} options={HANDLING_OPTIONS} disabled={dis} />
            </Field>
          </div>
        ) : null}
      </section>

      <section className="space-y-3">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-fg-muted">Approval</h3>
        <div>
          <span className="mb-1 block text-xs font-medium text-fg-muted">
            Who can approve <span className="font-normal text-fg-dim">roles holding approvals:decide; none selected means any of them</span>
          </span>
          {roles.length === 0 ? (
            <Note tone="warning">No role in this organization holds approvals:decide. Approvals would wait until one is created.</Note>
          ) : (
            <div className="grid gap-1 sm:grid-cols-2" role="group" aria-label="Approver roles">
              {roles.map((r) => (
                <Checkbox key={r.key} id={id(`role-${r.key}`)} checked={values.approverRoles.includes(r.key)} onCheckedChange={(on) => set("approverRoles", toggle(values.approverRoles, r.key, on))} disabled={dis} label={r.name} description={`${r.memberCount} member${r.memberCount === 1 ? "" : "s"}`} />
              ))}
            </div>
          )}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Approvers needed" htmlFor={id("min")} error={field("minApprovers")}>
            <Select id={id("min")} value={values.minApprovers} onValueChange={(v) => set("minApprovers", v)} options={[{ value: "1", label: "1 approver" }, { value: "2", label: "2 approvers" }, { value: "3", label: "3 approvers" }]} disabled={dis} />
          </Field>
          <Field label="Decide within" htmlFor={id("exp")} hint="minutes; markets move, so keep it short" error={field("approvalExpiresMinutes")}>
            <Input id={id("exp")} type="number" min={5} max={10080} value={values.approvalExpiresMinutes} onChange={(e) => set("approvalExpiresMinutes", e.target.value)} disabled={dis} aria-invalid={!!field("approvalExpiresMinutes")} />
          </Field>
        </div>
        <label className="flex items-center justify-between gap-3 rounded-md border border-line bg-bg px-3 py-2 text-sm">
          <span>
            <span className="block text-fg">Separation of duties</span>
            <span className="block text-xs text-fg-muted">Owners of the requesting agent cannot approve its orders.</span>
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

/** Live outcomes of the template's sample orders against the current settings. */
export function TradingSamplePreview({ settings }: { settings: TradingTemplateSettings | null }) {
  const key = React.useMemo(() => (settings ? JSON.stringify(settings) : null), [settings]);
  const debounced = useDebounced(key, 250);
  const [state, setState] = React.useState<{ key: string; preview: TradingTemplatePreview } | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);
  React.useEffect(() => {
    if (!debounced) return;
    let cancelled = false;
    setLoading(true);
    previewTradingTemplateAction(JSON.parse(debounced)).then((r) => {
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
        <SimpleTable caption="Sample order outcomes" className={cn("transition-opacity", stale && "opacity-60")}>
          <thead>
            <tr>
              <Th>Order</Th>
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
