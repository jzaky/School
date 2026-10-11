"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { History } from "lucide-react";
import { rollbackAction } from "@/server/actions/policies";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { StatusCell } from "@/components/ui/status";
import { Badge } from "@/components/ui/badge";
import { SimpleTable, Td, Th, Tr } from "@/components/ui/simple-table";
import { DateTime } from "@/components/ui/time";

export interface PolicyVersionRow {
  id: string;
  version: number;
  state: string;
  changeNote: string;
  createdByName: string;
  approvedByName: string | null;
  activatedAt: string | null;
  retiredAt: string | null;
  createdAt: string;
  contentHash: string;
}

export function PolicyVersionsTable({ policyId, versions, selectedId, activeId, canActivate }: { policyId: string; versions: PolicyVersionRow[]; selectedId: string; activeId: string | null; canActivate: boolean }) {
  const router = useRouter();
  const [rollback, setRollback] = React.useState<PolicyVersionRow | null>(null);
  return (
    <>
      <SimpleTable caption="Policy versions">
        <thead>
          <tr>
            <Th>Version</Th>
            <Th>State</Th>
            <Th>Change note</Th>
            <Th>Author</Th>
            <Th>Approved by</Th>
            <Th>Activated</Th>
            <Th>Retired</Th>
            <Th>Content hash</Th>
            <Th align="end">Actions</Th>
          </tr>
        </thead>
        <tbody>
          {versions.map((v) => {
            const selected = v.id === selectedId;
            return (
              <Tr key={v.id} className={selected ? "bg-accent/10" : undefined} aria-selected={selected}>
                <Td>
                  <span className="inline-flex items-center gap-2 font-mono text-xs">
                    v{v.version}
                    {v.id === activeId ? <Badge tone="allow">active</Badge> : null}
                    {selected ? <Badge tone="info">viewing</Badge> : null}
                  </span>
                </Td>
                <Td>
                  <StatusCell status={v.state} />
                </Td>
                <Td className="max-w-[280px] truncate" title={v.changeNote}>
                  {v.changeNote || <span className="text-fg-dim">none</span>}
                </Td>
                <Td>{v.createdByName}</Td>
                <Td>{v.approvedByName ?? <span className="text-fg-dim">none</span>}</Td>
                <Td>
                  <DateTime value={v.activatedAt} />
                </Td>
                <Td>
                  <DateTime value={v.retiredAt} />
                </Td>
                <Td mono>
                  <span title={v.contentHash}>{v.contentHash.slice(0, 12)}</span>
                </Td>
                <Td align="end">
                  <div className="flex justify-end gap-1">
                    <Button size="sm" variant="ghost" onClick={() => router.push(`/policies/${policyId}?v=${v.id}&tab=rules`)} disabled={selected} disabledReason="Already viewing this version">
                      View
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setRollback(v)} disabled={!canActivate || v.id === activeId} disabledReason={!canActivate ? "Requires policies:activate" : "This version is already active"}>
                      <History className="h-3.5 w-3.5" aria-hidden />
                      Rollback
                    </Button>
                  </div>
                </Td>
              </Tr>
            );
          })}
        </tbody>
      </SimpleTable>
      <ConfirmDialog
        open={rollback !== null}
        onOpenChange={(o) => !o && setRollback(null)}
        title={rollback ? `Roll back to v${rollback.version}` : ""}
        description="Creates a new active version with the same document. The current version is retired; nothing is overwritten."
        confirmLabel="Roll back"
        reason={{ required: true, placeholder: "Why this version is being restored" }}
        onConfirm={async ({ reason }) => {
          if (!rollback) return;
          const r = await rollbackAction(policyId, rollback.id, reason);
          if (!r.ok) return r.error;
          toast.success(`Rolled back: v${r.data.version} is now active`);
          router.push(`/policies/${policyId}?v=${r.data.versionId}&tab=versions`);
        }}
      />
    </>
  );
}
