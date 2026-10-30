"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { createAgentAction } from "@/server/actions/agents";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, FormError, Input, Textarea } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Combobox } from "@/components/ui/combobox";
import { statusLabel } from "@/lib/status";

export interface PickerOption {
  value: string;
  label: string;
  description?: string;
}

export function RegisterAgentDialog({ canWrite, members, teams }: { canWrite: boolean; members: PickerOption[]; teams: PickerOption[] }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [name, setName] = React.useState("");
  const [slug, setSlug] = React.useState("");
  const [slugTouched, setSlugTouched] = React.useState(false);
  const [environment, setEnvironment] = React.useState("development");
  const [riskTier, setRiskTier] = React.useState("medium");
  const [classification, setClassification] = React.useState("internal");
  const [businessOwnerId, setBusinessOwnerId] = React.useState<string | null>(null);
  const [technicalOwnerId, setTechnicalOwnerId] = React.useState<string | null>(null);
  const [teamId, setTeamId] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!slugTouched) setSlug(name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48));
  }, [name, slugTouched]);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setPending(true);
    setError(null);
    const r = await createAgentAction({
      name,
      slug,
      description: String(fd.get("description") ?? ""),
      environment,
      riskTier,
      dataClassificationLimit: classification,
      modelProvider: String(fd.get("modelProvider") ?? ""),
      modelId: String(fd.get("modelId") ?? ""),
      businessOwnerId,
      technicalOwnerId,
      teamId,
      metadata: {},
    });
    setPending(false);
    if (!r.ok) return setError(r.error);
    toast.success(`${name} registered as a draft`);
    setOpen(false);
    router.push(`/agents/${r.data.id}`);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setError(null);
      }}
      trigger={
        <Button variant="primary" disabled={!canWrite} disabledReason="Requires agents:write">
          <Plus className="h-3.5 w-3.5" aria-hidden />
          Register agent
        </Button>
      }
      title="Register an agent"
      description="The agent starts as a draft. Once its tools and permissions are in place, register and activate it from its page."
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
            Cancel
          </Button>
          <Button form="register-agent-form" type="submit" variant="primary" loading={pending} disabled={name.trim().length < 2 || slug.length < 2}>
            Register
          </Button>
        </>
      }
    >
      <form id="register-agent-form" onSubmit={submit} className="grid gap-3 md:grid-cols-2">
        <Field label="Name" htmlFor="agent-name">
          <Input id="agent-name" value={name} onChange={(e) => setName(e.target.value)} required minLength={2} maxLength={120} autoFocus />
        </Field>
        <Field label="Slug" htmlFor="agent-slug" hint="a short web-friendly name: lowercase letters, digits and hyphens">
          <Input
            id="agent-slug"
            value={slug}
            onChange={(e) => {
              setSlugTouched(true);
              setSlug(e.target.value);
            }}
            pattern="^[a-z0-9][a-z0-9-]*[a-z0-9]$"
            required
            className="font-mono"
          />
        </Field>
        <Field label="Description" htmlFor="agent-description" className="md:col-span-2">
          <Textarea id="agent-description" name="description" maxLength={2000} placeholder="What the agent does and who it serves" />
        </Field>
        <Field label="Environment" htmlFor="agent-env">
          <Select id="agent-env" value={environment} onValueChange={setEnvironment} options={["development", "staging", "production"].map((s) => ({ value: s, label: statusLabel(s) }))} />
        </Field>
        <Field label="Risk tier" htmlFor="agent-risk">
          <Select id="agent-risk" value={riskTier} onValueChange={setRiskTier} options={["low", "medium", "high", "critical"].map((s) => ({ value: s, label: statusLabel(s) }))} />
        </Field>
        <Field label="Model provider" htmlFor="agent-provider">
          <Input id="agent-provider" name="modelProvider" placeholder="anthropic" maxLength={80} />
        </Field>
        <Field label="Model id" htmlFor="agent-model">
          <Input id="agent-model" name="modelId" placeholder="claude-sonnet-5-5" maxLength={120} className="font-mono" />
        </Field>
        <Field label="Data classification limit" htmlFor="agent-class" hint="the most sensitive class of data this agent may handle">
          <Select id="agent-class" value={classification} onValueChange={setClassification} options={["public", "internal", "confidential", "restricted"].map((s) => ({ value: s, label: statusLabel(s) }))} />
        </Field>
        <Field label="Team" htmlFor="agent-team">
          <Combobox id="agent-team" value={teamId} onChange={setTeamId} options={teams} placeholder="No team" allowClear />
        </Field>
        <Field label="Business owner" htmlFor="agent-bo">
          <Combobox id="agent-bo" value={businessOwnerId} onChange={setBusinessOwnerId} options={members} placeholder="Select a member" allowClear />
        </Field>
        <Field label="Technical owner" htmlFor="agent-to">
          <Combobox id="agent-to" value={technicalOwnerId} onChange={setTechnicalOwnerId} options={members} placeholder="Select a member" allowClear />
        </Field>
        <div className="md:col-span-2">
          <FormError error={error} />
        </div>
      </form>
    </Dialog>
  );
}
