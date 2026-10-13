"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { buildRefundPolicyDocument, explainRefundPolicy } from "@aegis/core/policy/templates";
import { buildScoreBandPolicyDocument, explainScoreBandPolicy } from "@aegis/core/policy/score-band";
import { createPolicyAction } from "@/server/actions/policies";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, FormError, Input, Textarea } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Panel } from "@/components/ui/panel";
import { POLICY_CATEGORIES, POLICY_TEMPLATES } from "./policy-templates";
import { defaultRefundFormValues, parseRefundForm, RefundExplanation, RefundSamplePreview, RefundSettingsForm, type RoleOption, type ToolOptionLite } from "./policy-refund-form";
import { defaultScoreBandFormValues, parseScoreBandForm, ScoreBandSamplePreview, ScoreBandSettingsForm } from "./policy-score-band-form";

const GUIDED_REFUND = "refund-guided";
const GUIDED_SCORE = "score-band-guided";

export function NewPolicyDialog({ canWrite, roles = [], tools = [] }: { canWrite: boolean; roles?: RoleOption[]; tools?: ToolOptionLite[] }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [name, setName] = React.useState("");
  const [key, setKey] = React.useState("");
  const [keyTouched, setKeyTouched] = React.useState(false);
  const [category, setCategory] = React.useState("authorization");
  const [template, setTemplate] = React.useState(GUIDED_REFUND);
  const [description, setDescription] = React.useState("");
  const [refund, setRefund] = React.useState(defaultRefundFormValues);
  const [score, setScore] = React.useState(defaultScoreBandFormValues);
  const guided = template === GUIDED_REFUND;
  const guidedScore = template === GUIDED_SCORE;
  const parsedRefund = React.useMemo(() => (guided ? parseRefundForm(refund) : { settings: null, errors: {} }), [guided, refund]);
  const parsedScore = React.useMemo(() => (guidedScore ? parseScoreBandForm(score) : { settings: null, errors: {} }), [guidedScore, score]);
  const explanation = React.useMemo(() => (parsedRefund.settings ? explainRefundPolicy(parsedRefund.settings) : parsedScore.settings ? explainScoreBandPolicy(parsedScore.settings) : []), [parsedRefund.settings, parsedScore.settings]);

  React.useEffect(() => {
    if (!keyTouched) setKey(name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48));
  }, [name, keyTouched]);
  React.useEffect(() => {
    const t = POLICY_TEMPLATES.find((x) => x.id === template);
    if (t && t.id !== "empty") setCategory(t.category);
    if (template === GUIDED_REFUND || template === GUIDED_SCORE) setCategory("authorization");
  }, [template]);

  const templateOptions = [{ value: GUIDED_REFUND, label: "Refund policy (guided)" }, { value: GUIDED_SCORE, label: "Score-band policy (guided): route your model's score" }, ...POLICY_TEMPLATES.map((t) => ({ value: t.id, label: t.name }))];
  const submitBlocked = name.trim().length < 2 || key.length < 2 ? "Name and key are required" : (guided && !parsedRefund.settings) || (guidedScore && !parsedScore.settings) ? "Fix the highlighted threshold fields" : undefined;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (submitBlocked) return;
    setPending(true);
    setError(null);
    let document: unknown;
    let changeNote: string;
    if (guided) {
      document = buildRefundPolicyDocument(parsedRefund.settings!);
      changeNote = "Initial draft from the guided refund template";
    } else if (guidedScore) {
      document = buildScoreBandPolicyDocument(parsedScore.settings!);
      changeNote = "Initial draft from the guided score-band template";
    } else {
      const t = POLICY_TEMPLATES.find((x) => x.id === template)!;
      document = t.document;
      changeNote = `Initial draft from the ${t.name.toLowerCase()} template`;
    }
    const r = await createPolicyAction({ key, name, description, category, document, changeNote });
    setPending(false);
    if (!r.ok) return setError(r.error);
    toast.success(`${name} created as draft v1`);
    setOpen(false);
    router.push(`/policies/${r.data.id}?tab=${guided || guidedScore ? "thresholds" : "editor"}`);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setError(null);
      }}
      trigger={
        <Button variant="primary" disabled={!canWrite} disabledReason="Requires policies:write">
          <Plus className="h-3.5 w-3.5" aria-hidden />
          New policy
        </Button>
      }
      title="New policy"
      description="Creates the policy with a draft version 1. Nothing is enforced until a version is reviewed and activated by a second person."
      size="lg"
      className={guided || guidedScore ? "max-w-5xl" : undefined}
      footer={
        <>
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
            Cancel
          </Button>
          <Button form="new-policy-form" type="submit" variant="primary" loading={pending} disabled={!!submitBlocked} disabledReason={submitBlocked}>
            Create draft
          </Button>
        </>
      }
    >
      <form id="new-policy-form" onSubmit={submit} className="grid gap-3 md:grid-cols-2">
        <Field label="Name" htmlFor="policy-name">
          <Input id="policy-name" value={name} onChange={(e) => setName(e.target.value)} required minLength={2} maxLength={120} autoFocus />
        </Field>
        <Field label="Key" htmlFor="policy-key" hint="lowercase, digits, hyphens">
          <Input
            id="policy-key"
            value={key}
            onChange={(e) => {
              setKeyTouched(true);
              setKey(e.target.value);
            }}
            pattern="^[a-z0-9][a-z0-9-]*[a-z0-9]$"
            required
            className="font-mono"
          />
        </Field>
        <Field label="Description" htmlFor="policy-description" className="md:col-span-2">
          <Textarea id="policy-description" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={2000} placeholder="What this policy governs and why the thresholds are set as they are" />
        </Field>
        <Field label="Category" htmlFor="policy-category">
          <Select id="policy-category" value={category} onValueChange={setCategory} options={POLICY_CATEGORIES} />
        </Field>
        <Field label="Starting document" htmlFor="policy-template">
          <Select id="policy-template" value={template} onValueChange={setTemplate} options={templateOptions} />
        </Field>
        {guided ? (
          <>
            <p className="text-xs text-fg-muted md:col-span-2">Answer a few business questions and the policy rules, reasons, approver instructions and embedded tests are generated for you. The result is ordinary policy JSON you can still edit.</p>
            <div className="grid gap-4 md:col-span-2 xl:grid-cols-2">
              <Panel title="Settings" padded>
                <RefundSettingsForm values={refund} onChange={setRefund} errors={parsedRefund.errors} roles={roles} tools={tools} idPrefix="np" />
              </Panel>
              <div className="space-y-4">
                <Panel title="What this policy will do">{explanation.length ? <RefundExplanation lines={explanation} /> : <p className="text-xs text-deny">Fix the highlighted fields to see the explanation.</p>}</Panel>
                <Panel title="Sample requests" description="Dry runs against the generated document.">
                  <RefundSamplePreview settings={parsedRefund.settings} />
                </Panel>
              </div>
            </div>
          </>
        ) : guidedScore ? (
          <>
            <p className="text-xs text-fg-muted md:col-span-2">Route the score your own fraud or risk model already produces. Choose where the agent sends it and the boundaries of the clear, review, hold and block bands; the rules, approver instructions and embedded tests are generated for you.</p>
            <div className="grid gap-4 md:col-span-2 xl:grid-cols-2">
              <Panel title="Settings" padded>
                <ScoreBandSettingsForm values={score} onChange={setScore} errors={parsedScore.errors} roles={roles} tools={tools} idPrefix="nps" />
              </Panel>
              <div className="space-y-4">
                <Panel title="What this policy will do">{explanation.length ? <RefundExplanation lines={explanation} /> : <p className="text-xs text-deny">Fix the highlighted fields to see the explanation.</p>}</Panel>
                <Panel title="Sample requests" description="Dry runs against the generated document.">
                  <ScoreBandSamplePreview settings={parsedScore.settings} />
                </Panel>
              </div>
            </div>
          </>
        ) : (
          <p className="text-xs text-fg-muted md:col-span-2">{POLICY_TEMPLATES.find((t) => t.id === template)?.description} Thresholds in templates are placeholders to edit, not recommendations.</p>
        )}
        <div className="md:col-span-2">
          <FormError error={error} />
        </div>
      </form>
    </Dialog>
  );
}
