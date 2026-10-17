"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, Save, Trash2, WandSparkles } from "lucide-react";
import { policyDocumentSchema, operatorSchema, type PolicyDocument } from "@aegis/core/policy/schema";
import { createVersionAction, saveDraftAction } from "@/server/actions/policies";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, FormError, Input, Textarea } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Note } from "@/components/ui/note";
import { Panel } from "@/components/ui/panel";
import { statusTone } from "@/lib/status";
import { PolicyFlow } from "./policy-flow";
import { INPUT_ATTRIBUTES, EFFECT_LABEL } from "./policy-templates";

interface Issue {
  path: string;
  message: string;
}

function validate(text: string): { doc: PolicyDocument | null; raw: unknown; issues: Issue[] } {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    return { doc: null, raw: undefined, issues: [{ path: "document", message: e instanceof Error ? e.message : "Invalid JSON" }] };
  }
  const r = policyDocumentSchema.safeParse(raw);
  if (r.success) return { doc: r.data, raw, issues: [] };
  return { doc: null, raw, issues: r.error.issues.map((i) => ({ path: i.path.join(".") || "document", message: i.message })) };
}

type ValueKind = "number" | "string" | "list" | "boolean" | "none";

function parseValue(kind: ValueKind, text: string): unknown {
  if (kind === "none") return undefined;
  if (kind === "number") return Number(text);
  if (kind === "boolean") return text.trim().toLowerCase() === "true";
  if (kind === "list")
    return text
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => (s !== "" && Number.isFinite(Number(s)) ? Number(s) : s));
  return text;
}

export function PolicyEditor({ policyId, version, canWrite }: { policyId: string; version: { id: string; version: number; state: string; document: unknown }; canWrite: boolean }) {
  const router = useRouter();
  const initial = React.useMemo(() => JSON.stringify(version.document, null, 2), [version.document]);
  const [text, setText] = React.useState(initial);
  const [saving, setSaving] = React.useState(false);
  const [changeNote, setChangeNote] = React.useState("");
  const [newVersionOpen, setNewVersionOpen] = React.useState(false);
  const [newVersionError, setNewVersionError] = React.useState<string | null>(null);
  React.useEffect(() => setText(initial), [initial]);
  const { doc, raw, issues } = React.useMemo(() => validate(text), [text]);
  const lastValid = React.useRef<PolicyDocument | null>(null);
  if (doc) lastValid.current = doc;
  const dirty = text !== initial;
  const isDraft = version.state === "draft";
  const editable = isDraft && canWrite;

  // ---- builder state ----
  const rawDoc = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
  const ruleList: Record<string, unknown>[] = Array.isArray(rawDoc?.rules) ? (rawDoc!.rules as Record<string, unknown>[]) : [];
  const [selectedRule, setSelectedRule] = React.useState<string>("");
  const [newRule, setNewRule] = React.useState({ id: "", effect: "allow", description: "", reason: "" });
  const [cmp, setCmp] = React.useState<{ attr: string; op: string; kind: ValueKind; value: string }>({ attr: "params.amount", op: "lt", kind: "number", value: "" });
  const ops = operatorSchema.options;

  function write(next: Record<string, unknown>) {
    setText(JSON.stringify(next, null, 2));
  }
  function mutateRules(fn: (rules: Record<string, unknown>[]) => Record<string, unknown>[]) {
    if (!rawDoc) return;
    write({ ...rawDoc, rules: fn(ruleList.map((r) => ({ ...r }))) });
  }
  function addRule() {
    if (!newRule.id.trim()) return;
    const rule: Record<string, unknown> = { id: newRule.id.trim(), description: newRule.description, effect: newRule.effect, when: { always: true }, reason: newRule.reason };
    if (newRule.effect === "require_approval") rule.approval = { roles: [], minApprovers: 1, expiresInMinutes: 240, separationOfDuties: true, escalateToRoles: [], instructions: "" };
    mutateRules((rules) => [...rules, rule]);
    setSelectedRule(newRule.id.trim());
    setNewRule({ id: "", effect: "allow", description: "", reason: "" });
  }
  function addComparison() {
    if (!selectedRule || !cmp.attr.trim()) return;
    const comparison: Record<string, unknown> = { attr: cmp.attr.trim(), op: cmp.op };
    const v = parseValue(cmp.kind, cmp.value);
    if (v !== undefined) comparison.value = v;
    mutateRules((rules) =>
      rules.map((r) => {
        if (r.id !== selectedRule) return r;
        const when = r.when as Record<string, unknown> | undefined;
        if (!when || "always" in when) return { ...r, when: comparison };
        if (Array.isArray(when.all)) return { ...r, when: { all: [...when.all, comparison] } };
        return { ...r, when: { all: [when, comparison] } };
      }),
    );
  }
  function wrap(kind: "all" | "any" | "not") {
    mutateRules((rules) => rules.map((r) => (r.id === selectedRule ? { ...r, when: kind === "not" ? { not: r.when } : { [kind]: [r.when] } } : r)));
  }
  function removeRule() {
    mutateRules((rules) => rules.filter((r) => r.id !== selectedRule));
    setSelectedRule("");
  }
  function format() {
    if (raw !== undefined) setText(JSON.stringify(raw, null, 2));
  }

  async function save() {
    if (!doc) return;
    setSaving(true);
    const r = await saveDraftAction(policyId, version.id, { document: doc, changeNote: changeNote || undefined });
    setSaving(false);
    if (!r.ok) return toast.error(r.error);
    toast.success(`Draft v${version.version} saved`);
    router.refresh();
  }
  async function createVersion(e: React.FormEvent) {
    e.preventDefault();
    if (!doc) return;
    setSaving(true);
    setNewVersionError(null);
    const r = await createVersionAction(policyId, { document: doc, changeNote });
    setSaving(false);
    if (!r.ok) return setNewVersionError(r.error);
    toast.success(`Draft v${r.data.version} created`);
    setNewVersionOpen(false);
    router.push(`/policies/${policyId}?v=${r.data.versionId}&tab=editor`);
  }

  const selected = ruleList.find((r) => r.id === selectedRule);
  const builderDisabled = !editable || !rawDoc;

  return (
    <div className="space-y-4">
      {!isDraft ? (
        <Note>
          Version v{version.version} is {version.state} and can no longer be changed. Edits here are not saved over it: use <strong>New version from this document</strong> to create a draft carrying your changes.
        </Note>
      ) : !canWrite ? (
        <Note>You can look at the document and try changes in your browser, but saving needs the policies:write permission.</Note>
      ) : null}
      <div className="grid gap-4 xl:grid-cols-2">
        <Panel title="Rule graph" description="Each box is a rule, in the order they are checked, grouped by what they do. A deny rule beats an approval rule, which beats an allow rule; if nothing matches, the request is denied." padded={false}>
          <div className="p-2">
            <PolicyFlow doc={doc ?? lastValid.current} />
            {!doc ? <p className="mt-1 px-1 text-[11px] text-approval">Showing the last valid document while the JSON has errors.</p> : null}
          </div>
        </Panel>
        <Panel
          title="Document"
          description={dirty ? "Unsaved changes" : "Matches the stored version"}
          actions={
            <>
              <Button size="sm" variant="ghost" onClick={format} disabled={raw === undefined} disabledReason="Fix the JSON syntax first">
                <WandSparkles className="h-3.5 w-3.5" aria-hidden />
                Format
              </Button>
              {isDraft ? (
                <Button size="sm" variant="primary" onClick={save} loading={saving} disabled={!editable || !doc || !dirty} disabledReason={!canWrite ? "Requires policies:write" : !doc ? "Fix the issues listed under the document first" : !dirty ? "No changes to save" : undefined}>
                  <Save className="h-3.5 w-3.5" aria-hidden />
                  Save draft
                </Button>
              ) : (
                <Button size="sm" variant="primary" onClick={() => setNewVersionOpen(true)} disabled={!canWrite || !doc} disabledReason={!canWrite ? "Requires policies:write" : "Fix the issues listed under the document first"}>
                  <Plus className="h-3.5 w-3.5" aria-hidden />
                  New version from this document
                </Button>
              )}
            </>
          }
        >
          <label htmlFor="policy-json" className="sr-only">
            Policy document JSON
          </label>
          <Textarea id="policy-json" mono value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} className="min-h-[360px] leading-5" aria-invalid={issues.length > 0} aria-describedby="policy-json-issues" />
          <div id="policy-json-issues" className="mt-2 space-y-1" aria-live="polite">
            {issues.length === 0 ? (
              <p className="text-xs text-allow">Valid policy document: {doc?.rules.length} rules, {doc?.tests.length} tests.</p>
            ) : (
              issues.slice(0, 12).map((i, idx) => (
                <p key={idx} className="text-xs text-deny">
                  <span className="font-mono text-fg-muted">{i.path}</span>: {i.message}
                </p>
              ))
            )}
            {issues.length > 12 ? <p className="text-xs text-fg-dim">and {issues.length - 12} more</p> : null}
          </div>
          {isDraft ? (
            <Field label="Change note" htmlFor="policy-change-note" hint="optional, replaces the draft's note" className="mt-3">
              <Input id="policy-change-note" value={changeNote} onChange={(e) => setChangeNote(e.target.value)} maxLength={500} disabled={!editable} />
            </Field>
          ) : null}
        </Panel>
      </div>

      <Panel title="Rule builder" description="A simpler way to edit: what you add here is written into the same document above. Thresholds and attribute paths are yours to set.">
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-fg-muted">Add a rule</h3>
            <div className="grid gap-2 sm:grid-cols-2">
              <Field label="Rule id" htmlFor="nr-id">
                <Input id="nr-id" value={newRule.id} onChange={(e) => setNewRule({ ...newRule, id: e.target.value })} placeholder="deny-after-hours" className="font-mono" disabled={builderDisabled} />
              </Field>
              <Field label="Effect" htmlFor="nr-effect">
                <Select id="nr-effect" value={newRule.effect} onValueChange={(v) => setNewRule({ ...newRule, effect: v })} options={["deny", "require_approval", "allow"].map((e) => ({ value: e, label: EFFECT_LABEL[e]! }))} disabled={builderDisabled} />
              </Field>
              <Field label="Description" htmlFor="nr-desc">
                <Input id="nr-desc" value={newRule.description} onChange={(e) => setNewRule({ ...newRule, description: e.target.value })} disabled={builderDisabled} />
              </Field>
              <Field label="Reason returned" htmlFor="nr-reason">
                <Input id="nr-reason" value={newRule.reason} onChange={(e) => setNewRule({ ...newRule, reason: e.target.value })} disabled={builderDisabled} />
              </Field>
            </div>
            <Button size="sm" onClick={addRule} disabled={builderDisabled || !/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(newRule.id) || ruleList.some((r) => r.id === newRule.id)} disabledReason={builderDisabled ? (editable ? "Fix the JSON syntax first" : "Only a draft version can be edited") : "Enter a rule id that is not already used: letters, digits, hyphen, underscore"}>
              <Plus className="h-3.5 w-3.5" aria-hidden />
              Add rule (starts as always true)
            </Button>
          </div>
          <div className="space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-fg-muted">Edit a rule&apos;s condition</h3>
            <Field label="Rule" htmlFor="sel-rule">
              <Select id="sel-rule" value={selectedRule || "__none__"} onValueChange={(v) => setSelectedRule(v === "__none__" ? "" : v)} options={[{ value: "__none__", label: "Choose a rule" }, ...ruleList.map((r) => ({ value: String(r.id), label: `${String(r.id)} (${EFFECT_LABEL[String(r.effect)] ?? String(r.effect)})` }))]} disabled={builderDisabled} />
            </Field>
            {selected ? (
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <Badge tone={statusTone(String(selected.effect))}>{EFFECT_LABEL[String(selected.effect)] ?? String(selected.effect)}</Badge>
                <span className="font-mono text-fg-muted">when: {JSON.stringify(selected.when).slice(0, 140)}</span>
              </div>
            ) : null}
            <div className="grid gap-2 sm:grid-cols-4">
              <Field label="Attribute" htmlFor="cmp-attr" className="sm:col-span-2">
                <Input id="cmp-attr" list="policy-attrs" value={cmp.attr} onChange={(e) => setCmp({ ...cmp, attr: e.target.value })} className="font-mono" disabled={builderDisabled || !selected} />
                <datalist id="policy-attrs">
                  {INPUT_ATTRIBUTES.map((a) => (
                    <option key={a} value={a} />
                  ))}
                </datalist>
              </Field>
              <Field label="Operator" htmlFor="cmp-op">
                <Select id="cmp-op" value={cmp.op} onValueChange={(v) => setCmp({ ...cmp, op: v, kind: v === "exists" || v === "missing" ? "none" : ["in", "not_in", "between", "domain_in", "domain_not_in", "subset_of", "intersects"].includes(v) ? "list" : cmp.kind === "none" || cmp.kind === "list" ? "number" : cmp.kind })} options={ops.map((o) => ({ value: o, label: o }))} disabled={builderDisabled || !selected} />
              </Field>
              <Field label="Value type" htmlFor="cmp-kind">
                <Select id="cmp-kind" value={cmp.kind} onValueChange={(v) => setCmp({ ...cmp, kind: v as ValueKind })} options={[{ value: "number", label: "number" }, { value: "string", label: "string" }, { value: "list", label: "list (comma separated)" }, { value: "boolean", label: "boolean" }, { value: "none", label: "no value" }]} disabled={builderDisabled || !selected} />
              </Field>
              <Field label="Value" htmlFor="cmp-value" className="sm:col-span-4">
                <Input id="cmp-value" value={cmp.value} onChange={(e) => setCmp({ ...cmp, value: e.target.value })} placeholder={cmp.kind === "list" ? "500, 2500" : cmp.kind === "number" ? "500" : cmp.kind === "boolean" ? "true" : "AED"} className="font-mono" disabled={builderDisabled || !selected || cmp.kind === "none"} />
              </Field>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={addComparison} disabled={builderDisabled || !selected || !cmp.attr.trim() || (cmp.kind !== "none" && cmp.value.trim() === "")} disabledReason={!selected ? "Choose a rule first" : "Enter an attribute and a value first"}>
                <Plus className="h-3.5 w-3.5" aria-hidden />
                Add comparison
              </Button>
              <Button size="sm" variant="ghost" onClick={() => wrap("all")} disabled={builderDisabled || !selected} disabledReason="Choose a rule first">
                Wrap in ALL
              </Button>
              <Button size="sm" variant="ghost" onClick={() => wrap("any")} disabled={builderDisabled || !selected} disabledReason="Choose a rule first">
                Wrap in ANY
              </Button>
              <Button size="sm" variant="ghost" onClick={() => wrap("not")} disabled={builderDisabled || !selected} disabledReason="Choose a rule first">
                Wrap in NOT
              </Button>
              <Button size="sm" variant="danger" onClick={removeRule} disabled={builderDisabled || !selected} disabledReason="Choose a rule first">
                <Trash2 className="h-3.5 w-3.5" aria-hidden />
                Remove rule
              </Button>
            </div>
          </div>
        </div>
      </Panel>

      <Dialog
        open={newVersionOpen}
        onOpenChange={(o) => {
          setNewVersionOpen(o);
          if (!o) setNewVersionError(null);
        }}
        title={`New draft version of this policy`}
        description={`Creates v${version.version + 1} as a draft from the document in the editor. v${version.version} stays unchanged.`}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setNewVersionOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button form="new-version-form" type="submit" variant="primary" loading={saving} disabled={changeNote.trim().length < 2} disabledReason="Enter a change note first">
              Create draft
            </Button>
          </>
        }
      >
        <form id="new-version-form" onSubmit={createVersion} className="space-y-3">
          <Field label="Change note" htmlFor="nv-note" hint="required; a short note on what changed, shown in the version history">
            <Textarea id="nv-note" value={changeNote} onChange={(e) => setChangeNote(e.target.value)} maxLength={500} autoFocus />
          </Field>
          <FormError error={newVersionError} />
        </form>
      </Dialog>
    </div>
  );
}
