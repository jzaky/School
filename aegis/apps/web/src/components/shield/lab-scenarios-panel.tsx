"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { archiveLabScenarioAction, createLabScenarioAction, updateLabScenarioAction } from "@/server/actions/lab";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dialog } from "@/components/ui/dialog";
import { Field, FormError, Input, Textarea } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import type { LabTarget } from "./lab-run-form";

export const EXPECTATION_LABEL: Record<string, string> = {
  not_allowed: "Refused or held (any outcome but allow)",
  deny: "Denied",
  require_approval: "Held for approval",
  quarantine: "Quarantined",
  request_more_information: "More information requested",
  restrict: "Allowed with restrictions",
  allow: "Allowed (a legitimate request)",
};

export interface ScenarioView {
  id: string;
  key: string;
  name: string;
  description: string;
  version: number;
  definition: { tool?: string; params: { mode: "patch" | "replace"; values: Record<string, unknown> }; resource?: string | null; expected: string; target: { agentIds: string[] } };
}
export interface TemplateView {
  key: string;
  name: string;
  description: string;
  definition: { params?: { mode?: string; values?: Record<string, unknown> }; resource?: string | null; expected: string };
}

const RUN_TOOL = "__run_tool__";
const ANY_AGENT = "__any__";

function ScenarioForm({ initial, templates, targets, onDone }: { initial: ScenarioView | null; templates: TemplateView[]; targets: LabTarget[]; onDone: () => void }) {
  const router = useRouter();
  const tools = [...new Map(targets.flatMap((t) => t.tools).map((t) => [t.key, t])).values()];
  const [template, setTemplate] = React.useState("");
  const [key, setKey] = React.useState(initial?.key ?? "");
  const [name, setName] = React.useState(initial?.name ?? "");
  const [description, setDescription] = React.useState(initial?.description ?? "");
  const [tool, setTool] = React.useState(initial?.definition.tool ?? RUN_TOOL);
  const [mode, setMode] = React.useState<string>(initial?.definition.params.mode ?? "patch");
  const [params, setParams] = React.useState(JSON.stringify(initial?.definition.params.values ?? {}, null, 2));
  const [resourceMode, setResourceMode] = React.useState(initial?.definition.resource === null ? "none" : initial?.definition.resource ? "specific" : "keep");
  const [resource, setResource] = React.useState(initial?.definition.resource ?? "");
  const [expected, setExpected] = React.useState(initial?.definition.expected ?? "not_allowed");
  const [agent, setAgent] = React.useState(initial?.definition.target.agentIds[0] ?? ANY_AGENT);
  const [note, setNote] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);

  const applyTemplate = (k: string) => {
    setTemplate(k);
    const t = templates.find((x) => x.key === k);
    if (!t) return;
    if (!key) setKey(t.key);
    if (!name) setName(t.name);
    setDescription(t.description);
    setMode(t.definition.params?.mode ?? "patch");
    setParams(JSON.stringify(t.definition.params?.values ?? {}, null, 2));
    setResourceMode(t.definition.resource === null ? "none" : "keep");
    setExpected(t.definition.expected);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    let values: unknown;
    try {
      values = JSON.parse(params || "{}");
    } catch {
      return setError("Parameters must be valid JSON, for example {\"amount\": 5000}");
    }
    if (!values || typeof values !== "object" || Array.isArray(values)) return setError("Parameters must be a JSON object");
    const definition = {
      ...(tool === RUN_TOOL ? {} : { tool }),
      params: { mode, values },
      ...(resourceMode === "none" ? { resource: null } : resourceMode === "specific" ? { resource: resource.trim() } : {}),
      expected,
      target: { agentIds: agent === ANY_AGENT ? [] : [agent] },
    };
    setPending(true);
    const r = initial ? await updateLabScenarioAction(initial.id, { name, description, definition, note }) : await createLabScenarioAction({ key, name, description, definition });
    setPending(false);
    if (!r.ok) return setError(r.error);
    toast.success(initial ? `Saved as version ${initial.version + 1}` : "Scenario created");
    onDone();
    router.refresh();
  };

  return (
    <form className="space-y-3" onSubmit={submit} data-testid="lab-scenario-form">
      {!initial ? (
        <Field label="Start from a template" htmlFor="lab-tpl">
          <Select id="lab-tpl" aria-label="Start from a template" value={template} onValueChange={applyTemplate} placeholder="Blank scenario" options={templates.map((t) => ({ value: t.key, label: t.name }))} />
        </Field>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Key" htmlFor="lab-key" hint="Lowercase letters, digits and hyphens">
          <Input id="lab-key" value={key} onChange={(e) => setKey(e.target.value)} disabled={!!initial} required />
        </Field>
        <Field label="Name" htmlFor="lab-name">
          <Input id="lab-name" value={name} onChange={(e) => setName(e.target.value)} required />
        </Field>
      </div>
      <Field label="What it tests" htmlFor="lab-desc">
        <Input id="lab-desc" value={description} onChange={(e) => setDescription(e.target.value)} />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Tool" htmlFor="lab-tool">
          <Select id="lab-tool" aria-label="Tool" value={tool} onValueChange={setTool} options={[{ value: RUN_TOOL, label: "The tool the run attacks" }, ...tools.map((t) => ({ value: t.key, label: `${t.name} (${t.key})` }))]} />
        </Field>
        <Field label="Agent" htmlFor="lab-target">
          <Select id="lab-target" aria-label="Agent" value={agent} onValueChange={setAgent} options={[{ value: ANY_AGENT, label: "Any agent the lab runs against" }, ...targets.map((t) => ({ value: t.id, label: t.name }))]} />
        </Field>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Parameters" htmlFor="lab-mode">
          <Select id="lab-mode" aria-label="Parameters" value={mode} onValueChange={setMode} options={[{ value: "patch", label: "Change the agent's usual request" }, { value: "replace", label: "Send exactly these parameters" }]} />
        </Field>
        <Field label="Resource claimed" htmlFor="lab-res">
          <Select id="lab-res" aria-label="Resource claimed" value={resourceMode} onValueChange={setResourceMode} options={[{ value: "keep", label: "The agent's usual resource" }, { value: "none", label: "None" }, { value: "specific", label: "A specific resource" }]} />
        </Field>
      </div>
      {resourceMode === "specific" ? (
        <Field label="Resource key" htmlFor="lab-res-key">
          <Input id="lab-res-key" value={resource} onChange={(e) => setResource(e.target.value)} required />
        </Field>
      ) : null}
      <Field label="Parameter values (JSON)" htmlFor="lab-params">
        <Textarea id="lab-params" mono rows={4} value={params} onChange={(e) => setParams(e.target.value)} />
      </Field>
      <Field label="AEGIS should decide" htmlFor="lab-expected">
        <Select id="lab-expected" aria-label="AEGIS should decide" value={expected} onValueChange={setExpected} options={Object.entries(EXPECTATION_LABEL).map(([value, label]) => ({ value, label }))} />
      </Field>
      {initial ? (
        <Field label="What changed" htmlFor="lab-note">
          <Input id="lab-note" value={note} onChange={(e) => setNote(e.target.value)} required minLength={3} />
        </Field>
      ) : null}
      <FormError error={error} />
      <Button type="submit" variant="primary" loading={pending} data-testid="lab-scenario-save">
        {initial ? `Save as version ${initial.version + 1}` : "Create scenario"}
      </Button>
    </form>
  );
}

/** The organization's own scenarios: create from a template, change (each change is a new version), archive. */
export function LabScenariosPanel({ scenarios, templates, targets, canEdit }: { scenarios: ScenarioView[]; templates: TemplateView[]; targets: LabTarget[]; canEdit: boolean }) {
  const router = useRouter();
  const [editing, setEditing] = React.useState<ScenarioView | null | "new">(null);
  const [archiving, setArchiving] = React.useState<ScenarioView | null>(null);
  const agentName = new Map(targets.map((t) => [t.id, t.name]));
  return (
    <div className="space-y-3" data-testid="lab-custom-scenarios">
      {scenarios.length === 0 ? (
        <p className="text-sm text-fg-muted">No scenarios of your own yet. Start from a template and say what AEGIS should decide.</p>
      ) : (
        <ul className="divide-y divide-line text-sm">
          {scenarios.map((s) => (
            <li key={s.id} className="py-2" data-testid="lab-custom-scenario">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span>
                  <span className="font-medium text-fg">{s.name}</span> <Badge mono>v{s.version}</Badge>
                </span>
                {canEdit ? (
                  <span className="flex gap-1">
                    <Button size="sm" onClick={() => setEditing(s)}>
                      Change
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setArchiving(s)}>
                      Archive
                    </Button>
                  </span>
                ) : null}
              </div>
              <p className="text-xs text-fg-muted">
                Expects: {EXPECTATION_LABEL[s.definition.expected] ?? s.definition.expected}. {s.definition.target.agentIds.length ? `Agent: ${s.definition.target.agentIds.map((id) => agentName.get(id) ?? "another agent").join(", ")}.` : "Any agent."}
              </p>
            </li>
          ))}
        </ul>
      )}
      <Button onClick={() => setEditing("new")} disabled={!canEdit || targets.length === 0} disabledReason={!canEdit ? "Requires the security:write permission" : "No active agent holds a tool"} data-testid="lab-scenario-new">
        New scenario
      </Button>
      <Dialog open={editing !== null} onOpenChange={(o) => !o && setEditing(null)} title={editing === "new" ? "New lab scenario" : "Change scenario"} description="Runs only inside a lab run, through a temporary clone of the agent: decision-only, every control applies, nothing reaches your systems." size="lg">
        {editing !== null ? <ScenarioForm initial={editing === "new" ? null : editing} templates={templates} targets={targets} onDone={() => setEditing(null)} /> : null}
      </Dialog>
      <ConfirmDialog
        open={archiving !== null}
        onOpenChange={(o) => !o && setArchiving(null)}
        title={`Archive ${archiving?.name ?? ""}`}
        description="It stops running in new and scheduled runs. Its versions and past results stay on the record."
        confirmLabel="Archive"
        reason={{ label: "Why", required: true }}
        onConfirm={async ({ reason }) => {
          const r = await archiveLabScenarioAction(archiving!.id, reason);
          if (!r.ok) return r.error;
          toast.success("Scenario archived");
          setArchiving(null);
          router.refresh();
        }}
      />
    </div>
  );
}
