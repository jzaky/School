"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, Upload } from "lucide-react";
import { acceptSoftwareFindingAction, attachSoftwareEvidenceAction, decideSoftwareAction, requestSoftwareAction, updateSoftwareSettingsAction } from "@/server/actions/software";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, FormError, Input, Textarea } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";

const ECOSYSTEMS = ["npm", "pypi", "maven", "go", "nuget", "cargo", "container", "application", "browser_extension", "other"];

export function RequestSoftwareButton() {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [form, setForm] = React.useState({ name: "", ecosystem: "npm", version: "", purpose: "" });
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
      title="Ask to use software"
      description="Name the package or application and the exact version. The security team attaches its bill of materials and scan results, then decides."
      trigger={
        <Button variant="primary" data-testid="request-software">
          <Plus className="h-3.5 w-3.5" aria-hidden />
          Request software
        </Button>
      }
    >
      <form
        className="space-y-3"
        onSubmit={async (e) => {
          e.preventDefault();
          setPending(true);
          setError(null);
          const r = await requestSoftwareAction(form);
          setPending(false);
          if (!r.ok) return setError(r.error);
          toast.success("Request recorded");
          setOpen(false);
          router.push(`/security/software/${r.data.id}`);
        }}
      >
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Name" htmlFor="sw-name" className="sm:col-span-2">
            <Input id="sw-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required maxLength={200} />
          </Field>
          <Field label="Version" htmlFor="sw-version">
            <Input id="sw-version" value={form.version} onChange={(e) => setForm({ ...form, version: e.target.value })} required maxLength={80} />
          </Field>
        </div>
        <Field label="Kind" htmlFor="sw-eco">
          <NativeSelect id="sw-eco" value={form.ecosystem} onChange={(e) => setForm({ ...form, ecosystem: e.target.value })}>
            {ECOSYSTEMS.map((x) => (
              <option key={x} value={x}>
                {x.replace("_", " ")}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field label="What it is for" htmlFor="sw-purpose">
          <Textarea id="sw-purpose" value={form.purpose} onChange={(e) => setForm({ ...form, purpose: e.target.value })} rows={2} maxLength={1000} />
        </Field>
        <FormError error={error} />
        <div className="flex justify-end">
          <Button type="submit" variant="primary" loading={pending}>
            Send request
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

const EVIDENCE_FORMATS = [
  { value: "cyclonedx", label: "SBOM: CycloneDX JSON (Syft, Trivy, cdxgen)" },
  { value: "spdx", label: "SBOM: SPDX JSON" },
  { value: "npm_lock", label: "npm package-lock.json (version 2 or 3)" },
  { value: "grype", label: "Vulnerabilities: Grype JSON" },
  { value: "trivy", label: "Vulnerabilities and secrets: Trivy JSON" },
  { value: "gitleaks", label: "Secrets: Gitleaks JSON report" },
  { value: "scorecard", label: "Maintenance: OpenSSF Scorecard JSON" },
];

export function AttachEvidenceForm({ id, canWrite }: { id: string; canWrite: boolean }) {
  const router = useRouter();
  const [format, setFormat] = React.useState("cyclonedx");
  const [file, setFile] = React.useState<File | null>(null);
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  return (
    <form
      className="space-y-3"
      data-testid="attach-evidence"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!file) return;
        setPending(true);
        setError(null);
        const r = await attachSoftwareEvidenceAction({ id, format, text: await file.text() });
        setPending(false);
        if (!r.ok) return setError(r.error);
        toast.success(`Assessed: ${r.data.recommended.replace("_", " ")}, risk ${r.data.score}`);
        setFile(null);
        router.refresh();
      }}
    >
      <Field label="Report or SBOM" htmlFor="ev-format">
        <NativeSelect id="ev-format" value={format} onChange={(e) => setFormat(e.target.value)}>
          {EVIDENCE_FORMATS.map((f) => (
            <option key={f.value} value={f.value}>
              {f.label}
            </option>
          ))}
        </NativeSelect>
      </Field>
      <Field label="File" htmlFor="ev-file" hint="reduced to components and findings; the file is not kept, and secret values are never stored">
        <Input id="ev-file" type="file" accept=".json" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
      </Field>
      <FormError error={error} />
      <Button type="submit" variant="primary" loading={pending} disabled={!canWrite || !file} disabledReason={!canWrite ? "Needs the security:write permission" : "Choose a file"}>
        <Upload className="h-3.5 w-3.5" aria-hidden />
        Attach and reassess
      </Button>
    </form>
  );
}

const DECISIONS = [
  { value: "approved", label: "Approved" },
  { value: "restricted", label: "Restricted: allowed with conditions in the note" },
  { value: "under_review", label: "Under review" },
  { value: "quarantined", label: "Quarantined: do not use until resolved" },
  { value: "prohibited", label: "Prohibited" },
];

export function DecisionForm({ id, recommended, current, canDecide, reason }: { id: string; recommended: string; current: string; canDecide: boolean; reason: string }) {
  const router = useRouter();
  const [status, setStatus] = React.useState(current === "under_review" ? recommended : current);
  const [note, setNote] = React.useState("");
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  return (
    <form
      className="space-y-3"
      data-testid="software-decision"
      onSubmit={async (e) => {
        e.preventDefault();
        setPending(true);
        setError(null);
        const r = await decideSoftwareAction({ id, status, note });
        setPending(false);
        if (!r.ok) return setError(r.error);
        toast.success("Decision recorded");
        setNote("");
        router.refresh();
      }}
    >
      <Field label="Decision" htmlFor="sw-decision">
        <NativeSelect id="sw-decision" value={status} onChange={(e) => setStatus(e.target.value)} disabled={!canDecide}>
          {DECISIONS.map((d) => (
            <option key={d.value} value={d.value}>
              {d.label}
              {d.value === recommended ? " (recommended)" : ""}
            </option>
          ))}
        </NativeSelect>
      </Field>
      <Field label="Note" htmlFor="sw-note" hint="required when you decide below the recommendation">
        <Textarea id="sw-note" value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={2000} disabled={!canDecide} />
      </Field>
      <FormError error={error} />
      <Button type="submit" variant="primary" loading={pending} disabled={!canDecide} disabledReason={reason}>
        Record decision
      </Button>
    </form>
  );
}

export function AcceptFindingButton({ id, itemId, canWrite }: { id: string; itemId: string; canWrite: boolean }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [note, setNote] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);
  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
      title="Accept this risk?"
      description="The finding stays on record with your reason and stops counting toward the risk score."
      trigger={
        <Button size="sm" variant="ghost" disabled={!canWrite} disabledReason="Needs the security:write permission">
          Accept
        </Button>
      }
    >
      <form
        className="space-y-3"
        onSubmit={async (e) => {
          e.preventDefault();
          setPending(true);
          setError(null);
          const r = await acceptSoftwareFindingAction({ id, itemId, note });
          setPending(false);
          if (!r.ok) return setError(r.error);
          toast.success("Risk accepted");
          setOpen(false);
          router.refresh();
        }}
      >
        <Field label="Why the risk is acceptable" htmlFor={`acc-${id}`}>
          <Textarea id={`acc-${id}`} value={note} onChange={(e) => setNote(e.target.value)} rows={3} maxLength={2000} required />
        </Field>
        <FormError error={error} />
        <div className="flex justify-end">
          <Button type="submit" variant="primary" loading={pending}>
            Accept risk
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

export function SoftwareSettingsForm({ initial, canWrite }: { initial: { internalPrefixes: string[]; internalHosts: string[]; osvLookup: boolean; autoApprove: boolean }; canWrite: boolean }) {
  const router = useRouter();
  const [prefixes, setPrefixes] = React.useState(initial.internalPrefixes.join(", "));
  const [hosts, setHosts] = React.useState(initial.internalHosts.join(", "));
  const [osv, setOsv] = React.useState(initial.osvLookup);
  const [auto, setAuto] = React.useState(initial.autoApprove);
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const list = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);
  return (
    <form
      className="space-y-3"
      onSubmit={async (e) => {
        e.preventDefault();
        setPending(true);
        setError(null);
        const r = await updateSoftwareSettingsAction({ internalPrefixes: list(prefixes), internalHosts: list(hosts), osvLookup: osv, autoApprove: auto });
        setPending(false);
        if (!r.ok) return setError(r.error);
        toast.success("Settings saved");
        router.refresh();
      }}
    >
      <Field label="Internal package name prefixes" htmlFor="ss-prefixes" hint="for dependency confusion checks, for example @meridian/, mgb-">
        <Input id="ss-prefixes" value={prefixes} onChange={(e) => setPrefixes(e.target.value)} disabled={!canWrite} />
      </Field>
      <Field label="Internal registry hosts" htmlFor="ss-hosts">
        <Input id="ss-hosts" value={hosts} onChange={(e) => setHosts(e.target.value)} disabled={!canWrite} />
      </Field>
      <label className="flex items-center justify-between gap-3 text-sm">
        <span>
          Look up public packages on OSV.dev
          <span className="block text-xs text-fg-muted">Sends public package names and versions to osv.dev. Internal names are never sent.</span>
        </span>
        <Switch checked={osv} onCheckedChange={setOsv} disabled={!canWrite} aria-label="OSV lookup" />
      </label>
      <label className="flex items-center justify-between gap-3 text-sm">
        <span>
          Approve automatically when nothing is found
          <span className="block text-xs text-fg-muted">Off: a person decides every request.</span>
        </span>
        <Switch checked={auto} onCheckedChange={setAuto} disabled={!canWrite} aria-label="Automatic approval" />
      </label>
      <FormError error={error} />
      <Button type="submit" variant="secondary" loading={pending} disabled={!canWrite} disabledReason="Needs the security:write permission">
        Save settings
      </Button>
    </form>
  );
}
