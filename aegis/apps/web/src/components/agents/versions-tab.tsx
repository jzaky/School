"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { GitCommitVertical, Plus } from "lucide-react";
import { addVersionAction } from "@/server/actions/agents";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog } from "@/components/ui/dialog";
import { Field, FormError, Input, Textarea } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { CodeBlock } from "@/components/ui/code-block";
import { EmptyState } from "@/components/ui/empty-state";
import type { AgentCaps, AgentVersionRow } from "./types";
import { DateTime } from "@/components/ui/time";

export function VersionsTab({ agentId, versions, caps }: { agentId: string; versions: AgentVersionRow[]; caps: AgentCaps }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [manifest, setManifest] = React.useState(() => JSON.stringify(versions[0] ? JSON.parse(versions[0].manifest) : {}, null, 2));
  const [notes, setNotes] = React.useState("");
  const [deploy, setDeploy] = React.useState(false);
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const jsonError = React.useMemo(() => {
    try {
      const v = JSON.parse(manifest);
      return v && typeof v === "object" && !Array.isArray(v) ? null : "Manifest must be a JSON object";
    } catch (e) {
      return e instanceof Error ? `Invalid JSON: ${e.message}` : "Invalid JSON";
    }
  }, [manifest]);
  const blockedReason = !caps.canWrite ? "Requires agents:write" : !caps.editable ? `A ${caps.status} agent cannot be edited` : undefined;

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Dialog
          open={open}
          onOpenChange={setOpen}
          trigger={
            <Button variant="primary" disabled={!!blockedReason} disabledReason={blockedReason}>
              <Plus className="h-3.5 w-3.5" aria-hidden />
              Add version
            </Button>
          }
          title="Add a version"
          description="Versions are immutable snapshots of the agent manifest. Deploying makes it the current version."
          size="lg"
          footer={
            <>
              <Button variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
                Cancel
              </Button>
              <Button form="add-version-form" type="submit" variant="primary" loading={pending} disabled={!!jsonError} disabledReason={jsonError ?? undefined}>
                {deploy ? "Add and deploy" : "Add version"}
              </Button>
            </>
          }
        >
          <form
            id="add-version-form"
            className="space-y-3"
            onSubmit={async (e) => {
              e.preventDefault();
              setPending(true);
              setError(null);
              const r = await addVersionAction(agentId, { manifest, notes, deploy });
              setPending(false);
              if (!r.ok) return setError(r.error);
              toast.success(deploy ? "Version added and deployed" : "Version added");
              setOpen(false);
              setNotes("");
              router.refresh();
            }}
          >
            <Field label="Manifest" htmlFor="version-manifest" hint="JSON" error={jsonError}>
              <Textarea id="version-manifest" mono value={manifest} onChange={(e) => setManifest(e.target.value)} rows={12} spellCheck={false} />
            </Field>
            <Field label="Notes" htmlFor="version-notes">
              <Input id="version-notes" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={2000} placeholder="What changed" />
            </Field>
            <label className="flex items-center justify-between rounded-md border border-line px-3 py-2">
              <span>
                <span className="block text-sm text-fg">Deploy this version</span>
                <span className="block text-xs text-fg-muted">Sets it as the current version of the agent immediately.</span>
              </span>
              <Switch checked={deploy} onCheckedChange={setDeploy} aria-label="Deploy this version" />
            </label>
            <FormError error={error} />
          </form>
        </Dialog>
      </div>
      {versions.length === 0 ? (
        <EmptyState icon={GitCommitVertical} title="No versions" />
      ) : (
        <ol className="space-y-3">
          {versions.map((v) => (
            <li key={v.id} className="rounded-panel border border-line bg-bg-elev p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-sm font-semibold">v{v.version}</span>
                  {v.current ? <Badge tone="allow">Current</Badge> : null}
                  {v.deployedAt ? <Badge tone="info">Deployed <DateTime value={v.deployedAt} /></Badge> : <Badge>Not deployed</Badge>}
                </div>
                <div className="text-xs text-fg-dim">
                  <DateTime value={v.createdAt} /> by {v.createdBy}
                </div>
              </div>
              {v.notes ? <p className="mt-2 text-sm text-fg-muted">{v.notes}</p> : null}
              <details className="mt-2">
                <summary className="cursor-pointer text-xs text-accent">Manifest</summary>
                <CodeBlock code={JSON.stringify(JSON.parse(v.manifest), null, 2)} className="mt-2" />
              </details>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
