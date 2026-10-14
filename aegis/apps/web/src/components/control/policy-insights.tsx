"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { createFromSectorTemplateAction, decidePolicyExceptionAction, previewSectorTemplateAction, requestPolicyExceptionAction, revokePolicyExceptionAction } from "@/server/actions/policy-insights";
import { Button } from "@/components/ui/button";
import { Field, FormError, Input, Textarea } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";

type Template = { id: string; name: string; sector: string; summary: string };
type Preview = { rules: { id: string; effect: string; description: string }[]; tests: { name: string; expected: string; actual: string; passed: boolean }[] };

export function SectorTemplatePanel({ templates, tools, canWrite }: { templates: Template[]; tools: { key: string; name: string }[]; canWrite: boolean }) {
  const router = useRouter();
  const [id, setId] = React.useState(templates[0]?.id ?? "");
  const [picked, setPicked] = React.useState<string[]>(tools[0] ? [tools[0].key] : []);
  const [domains, setDomains] = React.useState("");
  const [key, setKey] = React.useState("");
  const [name, setName] = React.useState("");
  const [preview, setPreview] = React.useState<Preview | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState<"preview" | "create" | null>(null);
  const t = templates.find((x) => x.id === id);
  const settings = { tools: picked, approvedDomains: domains.split(/[\s,]+/).filter(Boolean) };
  return (
    <div className="grid gap-4 lg:grid-cols-2" data-testid="sector-templates">
      <div className="space-y-3">
        <Field label="Template" htmlFor="st-id">
          <Select
            id="st-id"
            value={id}
            onValueChange={(v) => {
              setId(v);
              setPreview(null);
            }}
            options={templates.map((x) => ({ value: x.id, label: `${x.name} (${x.sector})` }))}
          />
        </Field>
        {t ? <p className="text-sm text-fg-muted">{t.summary}</p> : null}
        <div>
          <span className="mb-1 block text-xs text-fg-muted">Tools it applies to</span>
          <div className="grid max-h-40 gap-x-2 overflow-auto sm:grid-cols-2">
            {tools.map((x) => (
              <Checkbox key={x.key} label={x.name} description={x.key} checked={picked.includes(x.key)} onCheckedChange={(v) => setPicked(v ? [...picked, x.key] : picked.filter((k) => k !== x.key))} />
            ))}
          </div>
        </div>
        {id === "personal-data-egress" || id === "health-records-minimum-necessary" ? (
          <Field label="Approved destination domains" htmlFor="st-domains" hint="comma separated; *.example.com allowed">
            <Input id="st-domains" value={domains} onChange={(e) => setDomains(e.target.value)} />
          </Field>
        ) : null}
        <Button
          size="sm"
          loading={pending === "preview"}
          disabled={picked.length === 0}
          disabledReason="Choose at least one tool"
          data-testid="sector-preview"
          onClick={async () => {
            setPending("preview");
            setError(null);
            const r = await previewSectorTemplateAction(id, settings);
            setPending(null);
            if (!r.ok) return setError(r.error);
            setPreview(r.data);
          }}
        >
          Preview rules and run its tests
        </Button>
        <FormError error={error} />
      </div>
      <div className="space-y-3">
        {preview ? (
          <>
            <ul className="space-y-1 text-sm" data-testid="sector-preview-rules">
              {preview.rules.map((r) => (
                <li key={r.id}>
                  <Badge>{r.effect.replace(/_/g, " ")}</Badge> <span className="font-mono text-xs">{r.id}</span> <span className="text-fg-muted">{r.description}</span>
                </li>
              ))}
            </ul>
            <ul className="space-y-1 text-xs" data-testid="sector-preview-tests">
              {preview.tests.map((x) => (
                <li key={x.name}>
                  <Badge tone={x.passed ? "allow" : "deny"}>{x.passed ? "pass" : "fail"}</Badge> {x.name}: expected {x.expected.replace(/_/g, " ")}, got {x.actual.replace(/_/g, " ")}
                </li>
              ))}
            </ul>
            <div className="grid gap-2 sm:grid-cols-2">
              <Field label="Policy key" htmlFor="st-key">
                <Input id="st-key" value={key} onChange={(e) => setKey(e.target.value)} className="font-mono" placeholder="secrets-guard" />
              </Field>
              <Field label="Name" htmlFor="st-name">
                <Input id="st-name" value={name} onChange={(e) => setName(e.target.value)} />
              </Field>
            </div>
            <Button
              size="sm"
              variant="primary"
              loading={pending === "create"}
              disabled={!canWrite || key.length < 2 || name.length < 2}
              disabledReason={!canWrite ? "Requires policies:write" : "Give a key and a name"}
              data-testid="sector-create"
              onClick={async () => {
                setPending("create");
                const r = await createFromSectorTemplateAction(id, settings, { key, name });
                setPending(null);
                if (!r.ok) return setError(r.error);
                toast.success("Draft created. Review and activate it like any policy.");
                router.push(`/policies/${r.data.id}`);
              }}
            >
              Create as a draft policy
            </Button>
          </>
        ) : (
          <p className="text-sm text-fg-muted">Preview shows the rules this template generates and runs its built-in tests. Nothing is saved until you create the draft, which still needs review and a second person to activate.</p>
        )}
      </div>
    </div>
  );
}

type PolicyOption = { id: string; name: string; rules: string[] };

export function ExceptionRequestForm({ policies, agents, canWrite }: { policies: PolicyOption[]; agents: { id: string; name: string }[]; canWrite: boolean }) {
  const router = useRouter();
  const [policyId, setPolicyId] = React.useState(policies[0]?.id ?? "");
  const rules = policies.find((p) => p.id === policyId)?.rules ?? [];
  const [ruleId, setRuleId] = React.useState(rules[0] ?? "");
  const [agentId, setAgentId] = React.useState(agents[0]?.id ?? "");
  const [days, setDays] = React.useState("7");
  const [reason, setReason] = React.useState("");
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  return (
    <form
      className="grid gap-3 md:grid-cols-2"
      data-testid="exception-request-form"
      onSubmit={async (e) => {
        e.preventDefault();
        setPending(true);
        setError(null);
        const r = await requestPolicyExceptionAction({ policyId, ruleId, agentId, toolKey: null, reason, days: Number(days) });
        setPending(false);
        if (!r.ok) return setError(r.error);
        toast.success("Exception requested; a second person with policies:activate must approve it");
        setReason("");
        router.refresh();
      }}
    >
      <Field label="Policy" htmlFor="ex-policy">
        <Select
          id="ex-policy"
          value={policyId}
          onValueChange={(v) => {
            setPolicyId(v);
            setRuleId(policies.find((p) => p.id === v)?.rules[0] ?? "");
          }}
          options={policies.map((p) => ({ value: p.id, label: p.name }))}
        />
      </Field>
      <Field label="Rule to skip" htmlFor="ex-rule">
        <Select id="ex-rule" value={ruleId} onValueChange={setRuleId} options={rules.map((r) => ({ value: r, label: r }))} />
      </Field>
      <Field label="Agent" htmlFor="ex-agent">
        <Select id="ex-agent" value={agentId} onValueChange={setAgentId} options={agents.map((a) => ({ value: a.id, label: a.name }))} />
      </Field>
      <Field label="Days (at most 90)" htmlFor="ex-days">
        <Input id="ex-days" type="number" min={1} max={90} value={days} onChange={(e) => setDays(e.target.value)} />
      </Field>
      <Field label="Business need" htmlFor="ex-reason" className="md:col-span-2">
        <Textarea id="ex-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={2000} />
      </Field>
      <div className="md:col-span-2">
        <FormError error={error} />
        <Button type="submit" size="sm" loading={pending} disabled={!canWrite || !ruleId || !agentId || reason.trim().length < 10} disabledReason={!canWrite ? "Requires policies:write" : "Choose a rule and an agent, and explain the need in at least 10 characters"}>
          Request exception
        </Button>
      </div>
    </form>
  );
}

export function ExceptionActions({ id, state, isRequester, canActivate }: { id: string; state: string; isRequester: boolean; canActivate: boolean }) {
  const router = useRouter();
  const [note, setNote] = React.useState("");
  const [pending, setPending] = React.useState<string | null>(null);
  const go = async (key: string, fn: () => Promise<{ ok: boolean; error?: string }>, done: string) => {
    setPending(key);
    const r = await fn();
    setPending(null);
    if (!r.ok) return toast.error(r.error ?? "Failed");
    toast.success(done);
    setNote("");
    router.refresh();
  };
  if (state !== "requested" && state !== "active") return null;
  const why = !canActivate ? "Requires policies:activate" : state === "requested" && isRequester ? "The requester cannot decide their own exception" : note.trim().length < 3 ? "Write a note" : undefined;
  return (
    <span className="flex flex-wrap items-center gap-2">
      <Input aria-label="Note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note" className="h-7 w-40 text-xs" />
      {state === "requested" ? (
        <>
          <Button size="sm" variant="primary" loading={pending === "approve"} disabled={!!why} disabledReason={why} onClick={() => go("approve", () => decidePolicyExceptionAction(id, true, note), "Exception approved")}>
            Approve
          </Button>
          <Button size="sm" loading={pending === "reject"} disabled={!!why} disabledReason={why} onClick={() => go("reject", () => decidePolicyExceptionAction(id, false, note), "Exception rejected")}>
            Reject
          </Button>
        </>
      ) : (
        <Button size="sm" variant="danger" loading={pending === "revoke"} disabled={!canActivate || note.trim().length < 3} disabledReason={!canActivate ? "Requires policies:activate" : "Write a note"} onClick={() => go("revoke", () => revokePolicyExceptionAction(id, note), "Exception revoked")}>
          Revoke now
        </Button>
      )}
    </span>
  );
}
