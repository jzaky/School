"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { createCustomerAction, draftInvoiceAction, invoiceAction, setContractAction, setPlanAction, updateSupportAction } from "@/server/actions/commercial";
import { Button } from "@/components/ui/button";
import { Field, FormError, Input, Textarea } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/select";
import type { ActionResult } from "@/lib/action-result";

function useSubmit() {
  const router = useRouter();
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  async function run<T>(fn: () => Promise<ActionResult<T>>, success: string): Promise<T | null> {
    setPending(true);
    setError(null);
    const r = await fn();
    setPending(false);
    if (!r.ok) {
      setError(r.error);
      return null;
    }
    toast.success(success);
    router.refresh();
    return r.data;
  }
  return { pending, error, run };
}

export function CreateCustomerForm() {
  const { pending, error, run } = useSubmit();
  const [name, setName] = React.useState("");
  const [slug, setSlug] = React.useState("");
  const [adminEmail, setAdminEmail] = React.useState("");
  const [plan, setPlan] = React.useState("trial");
  const [trialDays, setTrialDays] = React.useState("30");
  const [invite, setInvite] = React.useState<string | null>(null);
  return (
    <form
      className="space-y-3"
      data-testid="create-customer"
      onSubmit={async (e) => {
        e.preventDefault();
        const out = await run(() => createCustomerAction({ name, slug, adminEmail, plan, trialDays }), "Organization created");
        if (out) setInvite(`${window.location.origin}${out.invitePath}`);
      }}
    >
      <div className="grid gap-3 md:grid-cols-2">
        <Field label="Organization name" htmlFor="cc-name">
          <Input id="cc-name" value={name} onChange={(e) => setName(e.target.value)} required minLength={2} maxLength={120} />
        </Field>
        <Field label="Short name (slug)" htmlFor="cc-slug" hint="lowercase letters, numbers and hyphens">
          <Input id="cc-slug" value={slug} onChange={(e) => setSlug(e.target.value.toLowerCase())} required pattern="[a-z0-9][a-z0-9-]*" className="font-mono" />
        </Field>
        <Field label="First administrator's email" htmlFor="cc-email" hint="receives the owner invitation">
          <Input id="cc-email" type="email" value={adminEmail} onChange={(e) => setAdminEmail(e.target.value)} required />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Plan" htmlFor="cc-plan">
            <NativeSelect id="cc-plan" value={plan} onChange={(e) => setPlan(e.target.value)}>
              <option value="trial">Trial</option>
              <option value="core">Core</option>
              <option value="secure">Secure</option>
              <option value="enterprise">Enterprise</option>
            </NativeSelect>
          </Field>
          <Field label="Trial days" htmlFor="cc-days">
            <Input id="cc-days" type="number" min={1} max={180} value={trialDays} onChange={(e) => setTrialDays(e.target.value)} disabled={plan !== "trial"} />
          </Field>
        </div>
      </div>
      <FormError error={error} />
      {invite ? (
        <div className="rounded-md border border-allow/30 bg-allow/10 px-3 py-2 text-sm" data-testid="invite-link">
          Send this one-time invitation link to the first administrator (it expires in 7 days and is not shown again):
          <code className="mt-1 block break-all font-mono text-xs">{invite}</code>
        </div>
      ) : null}
      <div className="flex justify-end">
        <Button type="submit" variant="primary" loading={pending}>
          Create organization
        </Button>
      </div>
    </form>
  );
}

export function PlanForm({ orgId, plan, trialEndsAt }: { orgId: string; plan: string; trialEndsAt: string | null }) {
  const { pending, error, run } = useSubmit();
  const [p, setP] = React.useState(plan);
  const [ends, setEnds] = React.useState(trialEndsAt ? trialEndsAt.slice(0, 10) : "");
  return (
    <form
      className="flex flex-wrap items-end gap-3"
      onSubmit={async (e) => {
        e.preventDefault();
        await run(() => setPlanAction(orgId, { plan: p, trialEndsAt: p === "trial" && ends ? `${ends}T23:59:59Z` : null }), "Plan updated");
      }}
    >
      <Field label="Plan" htmlFor="pf-plan">
        <NativeSelect id="pf-plan" value={p} onChange={(e) => setP(e.target.value)}>
          <option value="trial">Trial</option>
          <option value="core">Core</option>
          <option value="secure">Secure</option>
          <option value="enterprise">Enterprise</option>
        </NativeSelect>
      </Field>
      <Field label="Trial ends" htmlFor="pf-ends">
        <Input id="pf-ends" type="date" value={ends} onChange={(e) => setEnds(e.target.value)} disabled={p !== "trial"} />
      </Field>
      <Button type="submit" loading={pending}>
        Save plan
      </Button>
      <FormError error={error} />
    </form>
  );
}

export function ContractForm({ orgId }: { orgId: string }) {
  const { pending, error, run } = useSubmit();
  const year = new Date().getUTCFullYear();
  const [f, setF] = React.useState({ plan: "core", termStart: `${year}-01-01`, termEnd: `${year}-12-31`, billingPeriod: "monthly", currency: "AED", periodFee: "", includedDecisions: "", overageUnitPrice: "", taxRatePercent: "0", paymentTermsDays: "30", purchaseOrder: "", notes: "" });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  return (
    <form
      className="space-y-3"
      data-testid="contract-form"
      onSubmit={async (e) => {
        e.preventDefault();
        await run(() => setContractAction(orgId, { ...f, includedDecisions: f.includedDecisions === "" ? null : f.includedDecisions, overageUnitPrice: f.overageUnitPrice === "" ? null : f.overageUnitPrice, purchaseOrder: f.purchaseOrder || undefined }), "Contract recorded");
      }}
    >
      <div className="grid gap-3 md:grid-cols-3">
        <Field label="Plan" htmlFor="ct-plan">
          <NativeSelect id="ct-plan" value={f.plan} onChange={set("plan")}>
            <option value="core">Core</option>
            <option value="secure">Secure</option>
            <option value="enterprise">Enterprise</option>
          </NativeSelect>
        </Field>
        <Field label="Term start" htmlFor="ct-start">
          <Input id="ct-start" type="date" value={f.termStart} onChange={set("termStart")} required />
        </Field>
        <Field label="Term end" htmlFor="ct-end">
          <Input id="ct-end" type="date" value={f.termEnd} onChange={set("termEnd")} required />
        </Field>
        <Field label="Billing period" htmlFor="ct-period">
          <NativeSelect id="ct-period" value={f.billingPeriod} onChange={set("billingPeriod")}>
            <option value="monthly">Monthly</option>
            <option value="quarterly">Quarterly</option>
            <option value="annual">Annual</option>
          </NativeSelect>
        </Field>
        <Field label="Currency" htmlFor="ct-cur">
          <Input id="ct-cur" value={f.currency} onChange={(e) => setF({ ...f, currency: e.target.value.toUpperCase() })} maxLength={3} pattern="[A-Z]{3}" className="font-mono" required />
        </Field>
        <Field label="Fee per period" htmlFor="ct-fee" hint="from the signed contract">
          <Input id="ct-fee" type="number" min={0} step="0.01" value={f.periodFee} onChange={set("periodFee")} required />
        </Field>
        <Field label="Included decisions per period" htmlFor="ct-inc" hint="empty for unlimited">
          <Input id="ct-inc" type="number" min={0} value={f.includedDecisions} onChange={set("includedDecisions")} />
        </Field>
        <Field label="Price per extra decision" htmlFor="ct-over" hint="up to 4 decimals; empty for none">
          <Input id="ct-over" type="number" min={0} step="0.0001" value={f.overageUnitPrice} onChange={set("overageUnitPrice")} />
        </Field>
        <Field label="Tax rate (%)" htmlFor="ct-tax" hint="only if the contract charges tax">
          <Input id="ct-tax" type="number" min={0} max={100} step="0.01" value={f.taxRatePercent} onChange={set("taxRatePercent")} />
        </Field>
        <Field label="Days to pay" htmlFor="ct-terms">
          <Input id="ct-terms" type="number" min={0} max={365} value={f.paymentTermsDays} onChange={set("paymentTermsDays")} />
        </Field>
        <Field label="Purchase order" htmlFor="ct-po">
          <Input id="ct-po" value={f.purchaseOrder} onChange={set("purchaseOrder")} maxLength={120} />
        </Field>
      </div>
      <Field label="Notes" htmlFor="ct-notes">
        <Textarea id="ct-notes" value={f.notes} onChange={set("notes")} rows={2} maxLength={2000} />
      </Field>
      <FormError error={error} />
      <div className="flex justify-end">
        <Button type="submit" variant="primary" loading={pending}>
          Record contract
        </Button>
      </div>
    </form>
  );
}

export function DraftInvoiceForm({ orgId, defaultPeriod, hasContract }: { orgId: string; defaultPeriod: string; hasContract: boolean }) {
  const { pending, error, run } = useSubmit();
  const [period, setPeriod] = React.useState(defaultPeriod);
  return (
    <form
      className="flex flex-wrap items-end gap-3"
      onSubmit={async (e) => {
        e.preventDefault();
        await run(() => draftInvoiceAction(orgId, period), "Invoice drafted");
      }}
    >
      <Field label="Period" htmlFor="di-period">
        <Input id="di-period" type="month" value={period} onChange={(e) => setPeriod(e.target.value)} required />
      </Field>
      <Button type="submit" loading={pending} disabled={!hasContract} disabledReason="Record a contract first">
        Draft invoice
      </Button>
      <FormError error={error} />
    </form>
  );
}

export function InvoiceActions({ orgId, invoiceId, status }: { orgId: string; invoiceId: string; status: string }) {
  const { pending, error, run } = useSubmit();
  const [ref, setRef] = React.useState("");
  const [reason, setReason] = React.useState("");
  return (
    <div className="flex flex-wrap items-center gap-2">
      {status === "draft" ? (
        <Button size="sm" loading={pending} onClick={() => run(() => invoiceAction(orgId, invoiceId, { action: "issue" }), "Invoice issued")}>
          Issue
        </Button>
      ) : null}
      {status === "issued" ? (
        <>
          <Input aria-label="Payment reference" placeholder="Payment reference" value={ref} onChange={(e) => setRef(e.target.value)} className="h-7 w-40 text-xs" />
          <Button size="sm" loading={pending} disabled={ref.trim().length < 2} disabledReason="Enter the payment reference" onClick={() => run(() => invoiceAction(orgId, invoiceId, { action: "mark_paid", paymentReference: ref }), "Payment recorded")}>
            Record payment
          </Button>
        </>
      ) : null}
      {status === "draft" || status === "issued" ? (
        <>
          <Input aria-label="Reason to void" placeholder="Reason to void" value={reason} onChange={(e) => setReason(e.target.value)} className="h-7 w-40 text-xs" />
          <Button size="sm" variant="danger" loading={pending} disabled={reason.trim().length < 5} disabledReason="Give a reason of at least five characters" onClick={() => run(() => invoiceAction(orgId, invoiceId, { action: "void", reason }), "Invoice voided")}>
            Void
          </Button>
        </>
      ) : null}
      <FormError error={error} />
    </div>
  );
}

export function SupportUpdateForm({ orgId, requestId, status, resolution }: { orgId: string; requestId: string; status: string; resolution: string }) {
  const { pending, error, run } = useSubmit();
  const [s, setS] = React.useState(status);
  const [r, setR] = React.useState(resolution);
  return (
    <form
      className="mt-2 flex flex-wrap items-end gap-2"
      onSubmit={async (e) => {
        e.preventDefault();
        await run(() => updateSupportAction(orgId, requestId, { status: s, resolution: r }), "Support request updated");
      }}
    >
      <NativeSelect aria-label="Status" value={s} onChange={(e) => setS(e.target.value)} className="h-7 text-xs">
        <option value="open">Open</option>
        <option value="in_progress">In progress</option>
        <option value="resolved">Resolved</option>
      </NativeSelect>
      <Input aria-label="Answer" placeholder="Answer to the customer" value={r} onChange={(e) => setR(e.target.value)} className="h-7 min-w-56 flex-1 text-xs" maxLength={5000} />
      <Button type="submit" size="sm" loading={pending}>
        Update
      </Button>
      <FormError error={error} />
    </form>
  );
}
