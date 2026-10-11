"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { createRuleAction, deleteRuleAction, updateRuleAction } from "@/server/actions/assurance";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Sheet } from "@/components/ui/sheet";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Field, FormError, Input, Textarea } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { SimpleTable, Td, Th, Tr } from "@/components/ui/simple-table";
import { TimeAgo } from "@/components/ui/time";
import { Note } from "@/components/ui/note";
import { statusLabel, statusTone } from "@/lib/status";

export interface RuleRow {
  id: string;
  key: string;
  name: string;
  description: string;
  severity: string;
  enabled: boolean;
  builtIn: boolean;
  definition: Record<string, unknown>;
  lastRunAt: string | null;
  openAlerts: number;
  totalAlerts: number;
}

interface ParamField {
  key: string;
  label: string;
  kind: "int" | "number" | "string";
  hint?: string;
  default: number | string;
}

/** Parameters per rule type, mirroring ruleDefinitionSchema in the core monitoring module. */
export const RULE_TYPES: Record<string, { label: string; summary: string; params: ParamField[] }> = {
  repeated_denials: { label: "Repeated denials", summary: "An agent was denied at least N times in the window", params: [{ key: "threshold", label: "Threshold (denials)", kind: "int", default: 5 }, { key: "windowMinutes", label: "Window (minutes)", kind: "int", default: 1440 }] },
  permission_escalation: { label: "Permission escalation", summary: "An agent tried tools, resources or classifications outside its grants", params: [{ key: "threshold", label: "Threshold (attempts)", kind: "int", default: 3 }, { key: "windowMinutes", label: "Window (minutes)", kind: "int", default: 1440 }] },
  unusual_tool_usage: { label: "Unusual tool usage", summary: "First use of a tool in the baseline period", params: [{ key: "baselineDays", label: "Baseline (days)", kind: "int", default: 30 }] },
  transaction_volume: { label: "Transaction volume", summary: "Executed amounts for one tool exceed a total in the window", params: [{ key: "toolKey", label: "Tool key", kind: "string", default: "initiate-transfer" }, { key: "amountThreshold", label: "Amount threshold", kind: "number", default: 1000000 }, { key: "windowMinutes", label: "Window (minutes)", kind: "int", default: 1440 }] },
  integration_failures: { label: "Integration failures", summary: "Failed executions against one integration", params: [{ key: "threshold", label: "Threshold (failures)", kind: "int", default: 3 }, { key: "windowMinutes", label: "Window (minutes)", kind: "int", default: 60 }] },
  policy_evaluation_failures: { label: "Policy evaluation failures", summary: "Decisions that ended in an evaluation error", params: [{ key: "threshold", label: "Threshold (errors)", kind: "int", default: 1 }, { key: "windowMinutes", label: "Window (minutes)", kind: "int", default: 60 }] },
  missing_evidence: { label: "Missing evidence or receipts", summary: "Allowed requests without a receipt, or requests without evidence", params: [{ key: "olderThanMinutes", label: "Older than (minutes)", kind: "int", default: 10 }] },
  abnormal_activity: { label: "Abnormal activity", summary: "Requests in the last hour exceed a multiple of the hourly baseline", params: [{ key: "multiplier", label: "Multiplier", kind: "number", default: 3 }, { key: "baselineDays", label: "Baseline (days)", kind: "int", default: 7 }, { key: "minimumRequests", label: "Minimum requests", kind: "int", default: 20 }] },
  approval_backlog: { label: "Approvals about to expire", summary: "Pending approvals expiring soon", params: [{ key: "expiringWithinMinutes", label: "Expiring within (minutes)", kind: "int", default: 60 }] },
  chain_integrity: { label: "Evidence chain integrity", summary: "Hash chain or checkpoint verification failed", params: [] },
  credential_rotation_due: { label: "Credential rotation due", summary: "Credentials due or overdue for rotation", params: [{ key: "withinDays", label: "Within (days)", kind: "int", default: 7 }] },
};

export function summarizeDefinition(def: Record<string, unknown>): string {
  return Object.entries(def)
    .filter(([k]) => k !== "type")
    .map(([k, v]) => `${k} ${typeof v === "number" ? v.toLocaleString("en-US") : String(v)}`)
    .join(", ") || "no parameters";
}

function ParamsForm({ type, values, onChange, idPrefix }: { type: string; values: Record<string, string>; onChange: (v: Record<string, string>) => void; idPrefix: string }) {
  const meta = RULE_TYPES[type];
  if (!meta) return null;
  if (meta.params.length === 0) return <p className="text-xs text-fg-dim">This rule type has no parameters.</p>;
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {meta.params.map((p) => (
        <Field key={p.key} label={p.label} htmlFor={`${idPrefix}-${p.key}`} hint={p.hint}>
          <Input id={`${idPrefix}-${p.key}`} type={p.kind === "string" ? "text" : "number"} step={p.kind === "number" ? "any" : 1} value={values[p.key] ?? ""} onChange={(e) => onChange({ ...values, [p.key]: e.target.value })} className={p.kind === "string" ? "font-mono" : undefined} />
        </Field>
      ))}
    </div>
  );
}

function buildDefinition(type: string, values: Record<string, string>): Record<string, unknown> {
  const meta = RULE_TYPES[type];
  const def: Record<string, unknown> = { type };
  for (const p of meta?.params ?? []) {
    const raw = values[p.key];
    if (raw === undefined || raw === "") continue;
    def[p.key] = p.kind === "string" ? raw : Number(raw);
  }
  return def;
}

const SEVERITIES = ["low", "medium", "high", "critical"];

export function MonitoringRulesTable({ rules, canWrite }: { rules: RuleRow[]; canWrite: boolean }) {
  const router = useRouter();
  const [editing, setEditing] = React.useState<RuleRow | null>(null);
  const [deleting, setDeleting] = React.useState<RuleRow | null>(null);
  const [toggling, setToggling] = React.useState<string | null>(null);
  const [form, setForm] = React.useState<{ name: string; description: string; severity: string; params: Record<string, string> }>({ name: "", description: "", severity: "medium", params: {} });
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  function startEdit(r: RuleRow) {
    setEditing(r);
    setError(null);
    setForm({ name: r.name, description: r.description, severity: r.severity, params: Object.fromEntries(Object.entries(r.definition).filter(([k]) => k !== "type").map(([k, v]) => [k, String(v)])) });
  }
  async function toggle(r: RuleRow, enabled: boolean) {
    setToggling(r.id);
    const res = await updateRuleAction(r.id, { enabled });
    setToggling(null);
    if (!res.ok) return toast.error(res.error);
    toast.success(`${r.key} ${enabled ? "enabled" : "disabled"}`);
    router.refresh();
  }
  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!editing) return;
    setSaving(true);
    setError(null);
    const type = String(editing.definition.type);
    const res = await updateRuleAction(editing.id, { name: form.name, description: form.description, severity: form.severity, definition: buildDefinition(type, form.params) });
    setSaving(false);
    if (!res.ok) return setError(res.error);
    toast.success(`${editing.key} updated`);
    setEditing(null);
    router.refresh();
  }

  return (
    <>
      <SimpleTable caption="Monitoring rules">
        <thead>
          <tr>
            <Th>Key</Th>
            <Th>Rule</Th>
            <Th>Severity</Th>
            <Th>Enabled</Th>
            <Th>Type</Th>
            <Th>Parameters</Th>
            <Th>Last run</Th>
            <Th align="end">Open alerts</Th>
            <Th align="end">Actions</Th>
          </tr>
        </thead>
        <tbody>
          {rules.map((r) => {
            const type = String(r.definition.type ?? "");
            return (
              <Tr key={r.id} data-rule-key={r.key}>
                <Td mono>
                  {r.key}
                  {r.builtIn ? <Badge className="ms-2">built-in</Badge> : <Badge className="ms-2" tone="info">custom</Badge>}
                </Td>
                <Td className="max-w-[320px]">
                  <span className="block truncate font-medium" title={r.name}>
                    {r.name}
                  </span>
                  <span className="block truncate text-xs text-fg-muted" title={r.description}>
                    {r.description}
                  </span>
                </Td>
                <Td>
                  <Badge tone={statusTone(r.severity)}>{statusLabel(r.severity)}</Badge>
                </Td>
                <Td>
                  <Switch checked={r.enabled} disabled={!canWrite || toggling === r.id} onCheckedChange={(v) => toggle(r, v)} aria-label={`${r.key} enabled`} />
                </Td>
                <Td className="text-xs">{RULE_TYPES[type]?.label ?? type}</Td>
                <Td className="max-w-[260px] truncate font-mono text-[11px] text-fg-muted" title={summarizeDefinition(r.definition)}>
                  {summarizeDefinition(r.definition)}
                </Td>
                <Td className="text-xs">{r.lastRunAt ? <TimeAgo value={r.lastRunAt} /> : <span className="text-fg-dim">never</span>}</Td>
                <Td align="end">{r.openAlerts > 0 ? <Badge tone="approval">{r.openAlerts}</Badge> : <span className="text-fg-dim">0</span>}</Td>
                <Td align="end">
                  <div className="flex justify-end gap-1">
                    <Button size="sm" variant="ghost" onClick={() => startEdit(r)} disabled={!canWrite} disabledReason="Requires monitoring:write">
                      <Pencil className="h-3.5 w-3.5" aria-hidden />
                      Edit
                    </Button>
                    <Button size="sm" variant="ghost" className="text-deny" onClick={() => setDeleting(r)} disabled={!canWrite || r.builtIn} disabledReason={r.builtIn ? "Built-in rules can be disabled but not deleted" : "Requires monitoring:write"}>
                      <Trash2 className="h-3.5 w-3.5" aria-hidden />
                      Delete
                    </Button>
                  </div>
                </Td>
              </Tr>
            );
          })}
        </tbody>
      </SimpleTable>
      <Sheet
        open={editing !== null}
        onOpenChange={(o) => !o && setEditing(null)}
        title={editing ? `Edit ${editing.key}` : ""}
        description={editing ? `${RULE_TYPES[String(editing.definition.type)]?.label ?? editing.definition.type}: ${RULE_TYPES[String(editing.definition.type)]?.summary ?? ""}. The type is fixed; thresholds, severity and wording can change.` : undefined}
        footer={
          <>
            <Button variant="ghost" onClick={() => setEditing(null)} disabled={saving}>
              Cancel
            </Button>
            <Button form="edit-rule-form" type="submit" variant="primary" loading={saving} disabled={form.name.trim().length < 3} disabledReason="A name of at least 3 characters is required">
              Save
            </Button>
          </>
        }
      >
        {editing ? (
          <form id="edit-rule-form" onSubmit={save} className="space-y-3">
            <Field label="Name" htmlFor="er-name">
              <Input id="er-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required minLength={3} maxLength={120} />
            </Field>
            <Field label="Description" htmlFor="er-desc" hint="plain language, shown on alerts">
              <Textarea id="er-desc" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} maxLength={500} />
            </Field>
            <Field label="Severity" htmlFor="er-sev">
              <Select id="er-sev" value={form.severity} onValueChange={(v) => setForm({ ...form, severity: v })} options={SEVERITIES.map((s) => ({ value: s, label: statusLabel(s) }))} />
            </Field>
            <div>
              <div className="mb-2 text-xs font-medium text-fg-muted">Thresholds</div>
              <ParamsForm type={String(editing.definition.type)} values={form.params} onChange={(params) => setForm({ ...form, params })} idPrefix="er" />
            </div>
            <FormError error={error} />
          </form>
        ) : null}
      </Sheet>
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={deleting ? `Delete ${deleting.key}` : ""}
        description="Existing alerts keep their detail but lose the link to this rule. The deletion is recorded in evidence."
        confirmLabel="Delete"
        danger
        typed={deleting?.key}
        onConfirm={async () => {
          if (!deleting) return;
          const r = await deleteRuleAction(deleting.id);
          if (!r.ok) return r.error;
          toast.success(`${deleting.key} deleted`);
          router.refresh();
        }}
      />
    </>
  );
}

export function CreateRuleDialog({ canWrite, existingKeys }: { canWrite: boolean; existingKeys: string[] }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const nextKey = React.useMemo(() => {
    const nums = existingKeys.map((k) => Number(k.replace(/^RM-/, ""))).filter((n) => Number.isFinite(n));
    return `RM-${String(Math.max(0, ...nums) + 1).padStart(3, "0")}`;
  }, [existingKeys]);
  const [key, setKey] = React.useState(nextKey);
  const [type, setType] = React.useState("repeated_denials");
  const [name, setName] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [severity, setSeverity] = React.useState("medium");
  const [params, setParams] = React.useState<Record<string, string>>(Object.fromEntries(RULE_TYPES.repeated_denials!.params.map((p) => [p.key, String(p.default)])));
  React.useEffect(() => setKey(nextKey), [nextKey]);
  function changeType(t: string) {
    setType(t);
    setParams(Object.fromEntries((RULE_TYPES[t]?.params ?? []).map((p) => [p.key, String(p.default)])));
  }
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const r = await createRuleAction({ key, name, description, severity, enabled: true, definition: buildDefinition(type, params) });
    setPending(false);
    if (!r.ok) return setError(r.error);
    toast.success(`${r.data.key} created`);
    setOpen(false);
    setName("");
    setDescription("");
    router.refresh();
  }
  const keyOk = /^[A-Z]{2,4}-\d{3}$/.test(key) && !existingKeys.includes(key);
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setError(null);
      }}
      trigger={
        <Button variant="primary" disabled={!canWrite} disabledReason="Requires monitoring:write">
          <Plus className="h-3.5 w-3.5" aria-hidden />
          New custom rule
        </Button>
      }
      title="New custom rule"
      description="Custom rules use the same deterministic checks as the built-ins with your own thresholds."
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
            Cancel
          </Button>
          <Button form="create-rule-form" type="submit" variant="primary" loading={pending} disabled={!keyOk || name.trim().length < 3} disabledReason={!keyOk ? "Key must look like RM-012 and be unused" : "A name of at least 3 characters is required"}>
            Create rule
          </Button>
        </>
      }
    >
      <form id="create-rule-form" onSubmit={submit} className="grid gap-3 md:grid-cols-2">
        <Field label="Key" htmlFor="cr-key" hint="like RM-012">
          <Input id="cr-key" value={key} onChange={(e) => setKey(e.target.value.toUpperCase())} className="font-mono" required />
        </Field>
        <Field label="Type" htmlFor="cr-type">
          <Select id="cr-type" value={type} onValueChange={changeType} options={Object.entries(RULE_TYPES).map(([k, v]) => ({ value: k, label: v.label }))} />
        </Field>
        <p className="text-xs text-fg-muted md:col-span-2">{RULE_TYPES[type]?.summary}</p>
        <Field label="Name" htmlFor="cr-name">
          <Input id="cr-name" value={name} onChange={(e) => setName(e.target.value)} required minLength={3} maxLength={120} />
        </Field>
        <Field label="Severity" htmlFor="cr-sev">
          <Select id="cr-sev" value={severity} onValueChange={setSeverity} options={SEVERITIES.map((s) => ({ value: s, label: statusLabel(s) }))} />
        </Field>
        <Field label="Description" htmlFor="cr-desc" className="md:col-span-2">
          <Textarea id="cr-desc" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={500} placeholder="What the rule detects, in plain language" />
        </Field>
        <div className="md:col-span-2">
          <div className="mb-2 text-xs font-medium text-fg-muted">Thresholds</div>
          <ParamsForm type={type} values={params} onChange={setParams} idPrefix="cr" />
        </div>
        <div className="md:col-span-2">
          <FormError error={error} />
        </div>
      </form>
    </Dialog>
  );
}

export function MonitoringNote() {
  return (
    <Note>
      Rules are deterministic checks over this organization&apos;s records: counts, sums and lists with explicit thresholds and windows. Every alert shows the definition that produced it, so anyone can reproduce the result. Nothing here predicts or scores.
    </Note>
  );
}
