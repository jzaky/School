"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { changeModelStageAction, decideModelAction, linkAgentModelAction, recordEvaluationAction, registerModelAction, requestModelApprovalAction, updateModelEnforcementAction } from "@/server/actions/governance-registry";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, FormError, Input, Textarea } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/switch";

const CATEGORIES = ["personal", "financial", "health", "biometric", "children", "credentials", "location", "employment", "public"];

export function RegisterModelDialog({ canWrite }: { canWrite: boolean }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [f, setF] = React.useState({ key: "", name: "", provider: "", providerModelId: "", version: "", riskTier: "medium", intendedUse: "", limitations: "", hostingRegion: "" });
  const [cats, setCats] = React.useState<string[]>([]);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const r = await registerModelAction({ ...f, dataCategories: cats, linkMatchingAgents: true });
    setPending(false);
    if (!r.ok) return setError(r.error);
    toast.success(`Model registered${r.data.agentsLinked ? `; ${r.data.agentsLinked} agent${r.data.agentsLinked === 1 ? "" : "s"} linked` : ""}`);
    setOpen(false);
    router.push(`/governance/models/${r.data.id}`);
  }
  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
      size="lg"
      trigger={
        <Button variant="primary" disabled={!canWrite} disabledReason="Requires agents:write" data-testid="model-register-open">
          <Plus className="h-3.5 w-3.5" aria-hidden />
          Register model
        </Button>
      }
      title="Register a model"
      description="Agents that report the same provider and model id are linked automatically."
      footer={
        <>
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
            Cancel
          </Button>
          <Button form="register-model-form" type="submit" variant="primary" loading={pending} data-testid="model-register-submit">
            Register
          </Button>
        </>
      }
    >
      <form id="register-model-form" onSubmit={submit} className="grid gap-3 md:grid-cols-2">
        <Field label="Key" htmlFor="m-key" hint="lowercase, stable">
          <Input id="m-key" value={f.key} onChange={set("key")} className="font-mono" placeholder="support-llm" maxLength={48} />
        </Field>
        <Field label="Name" htmlFor="m-name">
          <Input id="m-name" value={f.name} onChange={set("name")} maxLength={120} />
        </Field>
        <Field label="Provider" htmlFor="m-provider">
          <Input id="m-provider" value={f.provider} onChange={set("provider")} maxLength={80} />
        </Field>
        <Field label="Provider's model id" htmlFor="m-pmid" hint="as agents report it">
          <Input id="m-pmid" value={f.providerModelId} onChange={set("providerModelId")} className="font-mono" maxLength={120} />
        </Field>
        <Field label="Version" htmlFor="m-version">
          <Input id="m-version" value={f.version} onChange={set("version")} maxLength={60} />
        </Field>
        <Field label="Risk tier" htmlFor="m-risk">
          <Select id="m-risk" value={f.riskTier} onValueChange={(v) => setF({ ...f, riskTier: v })} options={["low", "medium", "high", "critical"].map((v) => ({ value: v, label: v }))} />
        </Field>
        <Field label="Intended use" htmlFor="m-use" className="md:col-span-2">
          <Textarea id="m-use" value={f.intendedUse} onChange={set("intendedUse")} maxLength={2000} />
        </Field>
        <Field label="Known limitations" htmlFor="m-limits" className="md:col-span-2">
          <Textarea id="m-limits" value={f.limitations} onChange={set("limitations")} maxLength={2000} />
        </Field>
        <Field label="Hosting region" htmlFor="m-region" hint="declared, not verified">
          <Input id="m-region" value={f.hostingRegion} onChange={set("hostingRegion")} maxLength={80} />
        </Field>
        <div className="md:col-span-2">
          <span className="mb-1 block text-xs text-fg-muted">Data the model may receive</span>
          <div className="grid grid-cols-2 gap-x-2 sm:grid-cols-3">
            {CATEGORIES.map((c) => (
              <Checkbox key={c} label={c} checked={cats.includes(c)} onCheckedChange={(v) => setCats(v ? [...cats, c] : cats.filter((x) => x !== c))} />
            ))}
          </div>
        </div>
        <div className="md:col-span-2">
          <FormError error={error} />
        </div>
      </form>
    </Dialog>
  );
}

const ENFORCEMENT = [
  { value: "off", label: "Record only" },
  { value: "require_approval", label: "Send to a person for approval" },
  { value: "deny", label: "Refuse" },
];

export function ModelEnforcementForm({ initial, canWrite }: { initial: string; canWrite: boolean }) {
  const router = useRouter();
  const [value, setValue] = React.useState(initial);
  const [pending, setPending] = React.useState(false);
  return (
    <form
      className="space-y-3"
      data-testid="model-enforcement-form"
      onSubmit={async (e) => {
        e.preventDefault();
        setPending(true);
        const r = await updateModelEnforcementAction({ enforcement: value });
        setPending(false);
        if (!r.ok) return toast.error(r.error);
        toast.success("Saved. Applies from the next request.");
        router.refresh();
      }}
    >
      <label className="block text-sm">
        <span className="mb-1 block text-xs text-fg-muted">When an agent&apos;s model is unregistered, not approved or retired</span>
        <Select id="model-enforcement" aria-label="Model enforcement" value={value} onValueChange={setValue} options={ENFORCEMENT} disabled={!canWrite} />
      </label>
      <Button type="submit" size="sm" loading={pending} disabled={!canWrite || value === initial} disabledReason={!canWrite ? "Requires the policies:activate permission" : "No change to save"}>
        Save
      </Button>
    </form>
  );
}

export function LinkAgentModel({ agentId, models, canWrite }: { agentId: string; models: { id: string; name: string }[]; canWrite: boolean }) {
  const router = useRouter();
  const [pending, setPending] = React.useState(false);
  return (
    <Select
      aria-label="Link to a registered model"
      size="sm"
      placeholder={pending ? "Linking..." : "Link to a model"}
      disabled={!canWrite || pending || models.length === 0}
      options={models.map((m) => ({ value: m.id, label: m.name }))}
      onValueChange={async (v) => {
        setPending(true);
        const r = await linkAgentModelAction(agentId, v);
        setPending(false);
        if (!r.ok) return toast.error(r.error);
        toast.success("Agent linked");
        router.refresh();
      }}
    />
  );
}

export function EvaluationForm({ modelId, canWrite }: { modelId: string; canWrite: boolean }) {
  const router = useRouter();
  const [kind, setKind] = React.useState("safety");
  const [result, setResult] = React.useState("pass");
  const [summary, setSummary] = React.useState("");
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  return (
    <form
      className="grid gap-3 sm:grid-cols-2"
      data-testid="evaluation-form"
      onSubmit={async (e) => {
        e.preventDefault();
        setPending(true);
        setError(null);
        const r = await recordEvaluationAction(modelId, { kind, result, summary });
        setPending(false);
        if (!r.ok) return setError(r.error);
        toast.success("Evaluation recorded");
        setSummary("");
        router.refresh();
      }}
    >
      <Field label="Kind" htmlFor="ev-kind">
        <Select id="ev-kind" value={kind} onValueChange={setKind} options={["accuracy", "safety", "bias", "security", "privacy", "other"].map((v) => ({ value: v, label: v }))} disabled={!canWrite} />
      </Field>
      <Field label="Result" htmlFor="ev-result">
        <Select id="ev-result" value={result} onValueChange={setResult} options={["pass", "conditional", "fail"].map((v) => ({ value: v, label: v }))} disabled={!canWrite} />
      </Field>
      <Field label="What was evaluated, how, and the outcome" htmlFor="ev-summary" className="sm:col-span-2">
        <Textarea id="ev-summary" value={summary} onChange={(e) => setSummary(e.target.value)} maxLength={4000} disabled={!canWrite} />
      </Field>
      <div className="sm:col-span-2">
        <FormError error={error} />
        <Button type="submit" size="sm" loading={pending} disabled={!canWrite || summary.trim().length < 10} disabledReason={!canWrite ? "Requires agents:write" : "Describe the evaluation in at least 10 characters"}>
          Record evaluation
        </Button>
      </div>
    </form>
  );
}

export function ModelLifecycleActions({ modelId, stage, canRequest, canDecide, blockers }: { modelId: string; stage: string; canRequest: boolean; canDecide: boolean; blockers: string[] }) {
  const router = useRouter();
  const [note, setNote] = React.useState("");
  const [pending, setPending] = React.useState<string | null>(null);
  const run = async (key: string, fn: () => Promise<{ ok: boolean; error?: string }>, done: string) => {
    setPending(key);
    const r = await fn();
    setPending(null);
    if (!r.ok) return toast.error(r.error ?? "Failed");
    toast.success(done);
    setNote("");
    router.refresh();
  };
  const noteOk = note.trim().length >= 5;
  return (
    <div className="space-y-3" data-testid="model-lifecycle">
      <Field label="Note for the record" htmlFor="ml-note">
        <Textarea id="ml-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} placeholder="Why this step is being taken" />
      </Field>
      <div className="flex flex-wrap gap-2">
        {stage === "proposed" ? (
          <Button size="sm" variant="primary" loading={pending === "request"} disabled={!canRequest || blockers.length > 0 || !noteOk} disabledReason={!canRequest ? "Requires agents:write" : blockers.length ? blockers.join("; ") : "Write a note of at least 5 characters"} onClick={() => run("request", () => requestModelApprovalAction(modelId, note), "Sent for approval")} data-testid="model-request-approval">
            Send for approval
          </Button>
        ) : null}
        {stage === "evaluating" ? (
          <>
            <Button size="sm" variant="primary" loading={pending === "approve"} disabled={!canDecide || !noteOk} disabledReason={!canDecide ? "Requires policies:activate, by someone other than the requester" : "Write a note of at least 5 characters"} onClick={() => run("approve", () => decideModelAction(modelId, { approve: true, note, reviewInDays: 365 }), "Model approved")} data-testid="model-approve">
              Approve (review in 12 months)
            </Button>
            <Button size="sm" loading={pending === "reject"} disabled={!canDecide || !noteOk} disabledReason={!canDecide ? "Requires policies:activate" : "Write a note of at least 5 characters"} onClick={() => run("reject", () => decideModelAction(modelId, { approve: false, note, reviewInDays: null }), "Sent back to proposed")}>
              Reject
            </Button>
          </>
        ) : null}
        {stage === "approved" ? (
          <Button size="sm" loading={pending === "deprecate"} disabled={!canDecide || !noteOk} disabledReason={!canDecide ? "Requires policies:activate" : "Write a note of at least 5 characters"} onClick={() => run("deprecate", () => changeModelStageAction(modelId, { to: "deprecated", reason: note }), "Model deprecated")}>
            Deprecate
          </Button>
        ) : null}
        {stage !== "retired" ? (
          <Button size="sm" variant="danger" loading={pending === "retire"} disabled={!canDecide || !noteOk} disabledReason={!canDecide ? "Requires policies:activate" : "Write a note of at least 5 characters"} onClick={() => run("retire", () => changeModelStageAction(modelId, { to: "retired", reason: note }), "Model retired")} data-testid="model-retire">
            Retire
          </Button>
        ) : (
          <p className="text-sm text-fg-muted">Retired models take no further steps.</p>
        )}
      </div>
    </div>
  );
}
