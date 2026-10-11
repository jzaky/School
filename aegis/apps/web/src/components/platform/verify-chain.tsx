"use client";
import * as React from "react";
import { ShieldCheck, ShieldX } from "lucide-react";
import { verifyTenantChainAction } from "@/server/actions/platform";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { FormError } from "@/components/ui/input";
import { KeyValue } from "@/components/ui/key-value";
import { Badge } from "@/components/ui/badge";

type Result = Awaited<ReturnType<typeof verifyTenantChainAction>> extends infer R ? (R extends { ok: true; data: infer D } ? D : never) : never;

export function VerifyChainTool({ orgs }: { orgs: { id: string; name: string; slug: string }[] }) {
  const [orgId, setOrgId] = React.useState(orgs[0]?.id ?? "");
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [result, setResult] = React.useState<Result | null>(null);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <div className="w-72">
          <label htmlFor="verify-org" className="mb-1 block text-xs font-medium text-fg-muted">
            Organization
          </label>
          <Select id="verify-org" value={orgId} onValueChange={setOrgId} options={orgs.map((o) => ({ value: o.id, label: `${o.name} (${o.slug})` }))} disabled={orgs.length === 0} />
        </div>
        <Button
          variant="primary"
          loading={pending}
          disabled={!orgId}
          disabledReason="No organizations"
          onClick={async () => {
            setPending(true);
            setError(null);
            setResult(null);
            const r = await verifyTenantChainAction(orgId);
            setPending(false);
            if (!r.ok) return setError(r.error);
            setResult(r.data);
          }}
        >
          Verify evidence chain
        </Button>
      </div>
      <FormError error={error} />
      {result ? (
        <div className={`rounded-md border px-4 py-3 ${result.valid ? "border-allow/30 bg-allow/10" : "border-deny/30 bg-deny/10"}`} role="status">
          <div className="mb-2 flex items-center gap-2 text-sm font-medium">
            {result.valid ? <ShieldCheck className="h-4 w-4 text-allow" aria-hidden /> : <ShieldX className="h-4 w-4 text-deny" aria-hidden />}
            {result.valid ? "Chain valid" : result.firstBadSeq ? `Chain broken at seq ${result.firstBadSeq}` : "Checkpoint verification failed"}
            <Badge>{result.org.name}</Badge>
          </div>
          <KeyValue
            columns={2}
            items={[
              { label: "Events checked", value: result.checked },
              { label: "Duration", value: `${result.durationMs} ms` },
              { label: "Reason", value: result.reason ?? "none" },
              { label: "Last hash", value: result.lastHash ? result.lastHash.slice(0, 24) : null, mono: true },
              { label: "Checkpoints", value: result.checkpoints.length ? `${result.checkpoints.filter((c) => c.valid).length} of ${result.checkpoints.length} valid` : "none" },
            ]}
          />
        </div>
      ) : null}
    </div>
  );
}
