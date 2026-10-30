"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";
import { toast } from "sonner";
import { Users } from "lucide-react";
import { changeMemberRoleAction, setMemberStatusAction } from "@/server/actions/org";
import { DataTable } from "@/components/ui/data-table";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { StatusCell } from "@/components/ui/status";
import { EmptyState } from "@/components/ui/empty-state";
import { Tooltip } from "@/components/ui/tooltip";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { TimeAgo } from "@/components/ui/time";

export interface MemberRow {
  id: string;
  userId: string;
  name: string;
  email: string;
  roleId: string;
  roleName: string;
  roleKey: string;
  title: string | null;
  status: string;
  mfaEnabled: boolean;
  lastLoginAt: string | null;
  userStatus: string;
}

export function UsersTable({ rows, roles, canWrite, selfUserId, q }: { rows: MemberRow[]; roles: { id: string; name: string; key: string }[]; canWrite: boolean; selfUserId: string; q: string }) {
  const router = useRouter();
  const [busy, setBusy] = React.useState<string | null>(null);
  const [confirm, setConfirm] = React.useState<{ row: MemberRow; status: "active" | "suspended" } | null>(null);
  const filtered = q ? rows.filter((r) => r.name.toLowerCase().includes(q.toLowerCase()) || r.email.toLowerCase().includes(q.toLowerCase())) : rows;

  const columns: ColumnDef<MemberRow, unknown>[] = [
    { id: "name", header: "Name", enableHiding: false, cell: ({ row }) => (
      <span className="block min-w-0">
        <span className="block truncate font-medium">{row.original.name}{row.original.userId === selfUserId ? <span className="ms-1 text-xs text-fg-dim">(you)</span> : null}</span>
        <span className="block truncate text-xs text-fg-muted">{row.original.email}</span>
      </span>
    ) },
    { id: "role", header: "Role", cell: ({ row }) => {
      const m = row.original;
      const self = m.userId === selfUserId;
      if (!canWrite) return m.roleName;
      const reason = self ? "You cannot change your own role" : undefined;
      const sel = (
        <span data-no-row-click className="block w-44">
          <Select aria-label={`Role for ${m.name}`} size="sm" value={m.roleId} disabled={self || busy === m.id} options={roles.map((r) => ({ value: r.id, label: r.name }))} onValueChange={async (roleId) => {
            if (roleId === m.roleId) return;
            setBusy(m.id);
            const r = await changeMemberRoleAction(m.id, roleId);
            setBusy(null);
            if (!r.ok) return toast.error(r.error);
            toast.success(`${m.name} is now ${roles.find((x) => x.id === roleId)?.name}`);
            router.refresh();
          }} />
        </span>
      );
      return reason ? <Tooltip content={reason}>{sel}</Tooltip> : sel;
    } },
    { id: "title", header: "Title", cell: ({ row }) => row.original.title ?? <span className="text-fg-dim">none</span> },
    { id: "status", header: "Status", cell: ({ row }) => <StatusCell status={row.original.status} /> },
    { id: "mfa", header: "MFA", cell: ({ row }) => <Badge tone={row.original.mfaEnabled ? "allow" : "neutral"}>{row.original.mfaEnabled ? "On" : "Off"}</Badge> },
    { id: "lastLogin", header: "Last login", cell: ({ row }) => (row.original.lastLoginAt ? <TimeAgo value={row.original.lastLoginAt} /> : <span className="text-fg-dim">never</span>) },
    { id: "actions", header: "", enableHiding: false, meta: { align: "end" }, cell: ({ row }) => {
      const m = row.original;
      const self = m.userId === selfUserId;
      const next = m.status === "active" ? "suspended" : "active";
      return (
        <Button size="sm" variant="ghost" className={next === "suspended" ? "text-deny" : "text-allow"} disabled={!canWrite || self} disabledReason={!canWrite ? "Requires users:write" : "You cannot change your own status"} onClick={() => setConfirm({ row: m, status: next })}>
          {next === "suspended" ? "Suspend" : "Reactivate"}
        </Button>
      );
    } },
  ];

  return (
    <>
      <DataTable columns={columns} data={filtered} getRowId={(r) => r.id} storageKey="members" caption="Members" emptyState={<EmptyState icon={Users} title={q ? "No members match" : "No members"} />} />
      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={confirm ? `${confirm.status === "suspended" ? "Suspend" : "Reactivate"} ${confirm.row.name}` : ""}
        description={confirm?.status === "suspended" ? "This person loses access to this organization immediately. If they belong to other organizations, they stay signed in to those." : "This person gets access back with the same role they had before."}
        confirmLabel={confirm?.status === "suspended" ? "Suspend member" : "Reactivate"}
        danger={confirm?.status === "suspended"}
        onConfirm={async () => {
          if (!confirm) return;
          const r = await setMemberStatusAction(confirm.row.id, confirm.status);
          if (!r.ok) return r.error;
          toast.success(`${confirm.row.name} ${confirm.status === "suspended" ? "suspended" : "reactivated"}`);
          router.refresh();
        }}
      />
    </>
  );
}
