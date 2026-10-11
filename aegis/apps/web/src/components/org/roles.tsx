"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";
import { toast } from "sonner";
import { Plus, ShieldCheck } from "lucide-react";
import { createRoleAction, deleteRoleAction, updateRoleAction } from "@/server/actions/org";
import { DataTable } from "@/components/ui/data-table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog } from "@/components/ui/dialog";
import { Sheet } from "@/components/ui/sheet";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Field, FormError, Input, Textarea } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/switch";
import { EmptyState } from "@/components/ui/empty-state";

export interface RoleRow {
  id: string;
  key: string;
  name: string;
  description: string;
  permissions: string[];
  isSystem: boolean;
  memberCount: number;
}

export interface PermissionInfo {
  key: string;
  description: string;
  area: string;
}

function groupByArea(perms: PermissionInfo[]) {
  const map = new Map<string, PermissionInfo[]>();
  for (const p of perms) {
    const list = map.get(p.area) ?? [];
    list.push(p);
    map.set(p.area, list);
  }
  return [...map.entries()];
}

function PermissionPicker({ catalog, selected, onChange, readOnly }: { catalog: PermissionInfo[]; selected: Set<string>; onChange?: (next: Set<string>) => void; readOnly?: boolean }) {
  return (
    <div className="space-y-3">
      {groupByArea(catalog).map(([area, perms]) => (
        <div key={area}>
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-fg-dim">{area}</div>
          <div className="rounded-md border border-line">
            {perms.map((p) => (
              <div key={p.key} className="border-b border-line last:border-b-0">
                {readOnly ? (
                  <div className="flex items-start gap-2.5 px-2 py-1.5">
                    <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${selected.has(p.key) ? "bg-allow" : "bg-line-strong"}`} aria-hidden />
                    <span className="min-w-0">
                      <span className="block font-mono text-xs text-fg">{p.key}</span>
                      <span className="block text-xs text-fg-muted">{p.description}</span>
                    </span>
                    <span className="ms-auto text-[11px] text-fg-dim">{selected.has(p.key) ? "granted" : ""}</span>
                  </div>
                ) : (
                  <Checkbox
                    checked={selected.has(p.key)}
                    onCheckedChange={(v) => {
                      const next = new Set(selected);
                      if (v) next.add(p.key);
                      else next.delete(p.key);
                      onChange?.(next);
                    }}
                    label={<span className="font-mono text-xs">{p.key}</span>}
                    description={p.description}
                  />
                )}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export function CreateRoleDialog({ catalog, canWrite }: { catalog: PermissionInfo[]; canWrite: boolean }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [name, setName] = React.useState("");
  const [key, setKey] = React.useState("");
  const [touched, setTouched] = React.useState(false);
  const [description, setDescription] = React.useState("");
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (!touched) setKey(name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48));
  }, [name, touched]);
  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
      trigger={
        <Button variant="primary" disabled={!canWrite} disabledReason="Requires users:write">
          <Plus className="h-3.5 w-3.5" aria-hidden />
          Create role
        </Button>
      }
      title="Create a custom role"
      description="Pick the permissions this role grants. System roles cannot be changed."
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
            Cancel
          </Button>
          <Button form="create-role-form" type="submit" variant="primary" loading={pending} disabled={name.trim().length < 2 || key.length < 2 || selected.size === 0} disabledReason={selected.size === 0 ? "Choose at least one permission" : undefined}>
            Create role
          </Button>
        </>
      }
    >
      <form
        id="create-role-form"
        className="space-y-3"
        onSubmit={async (e) => {
          e.preventDefault();
          setPending(true);
          setError(null);
          const r = await createRoleAction({ name, key, description, permissions: [...selected] });
          setPending(false);
          if (!r.ok) return setError(r.error);
          toast.success(`Role ${name} created`);
          setOpen(false);
          setName("");
          setDescription("");
          setSelected(new Set());
          setTouched(false);
          router.refresh();
        }}
      >
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Name" htmlFor="role-name">
            <Input id="role-name" value={name} onChange={(e) => setName(e.target.value)} required autoFocus maxLength={80} />
          </Field>
          <Field label="Key" htmlFor="role-key" hint="lowercase, digits, hyphens">
            <Input id="role-key" value={key} onChange={(e) => { setTouched(true); setKey(e.target.value); }} className="font-mono" pattern="^[a-z0-9][a-z0-9-]*[a-z0-9]$" required />
          </Field>
          <Field label="Description" htmlFor="role-desc" className="md:col-span-2">
            <Textarea id="role-desc" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={300} rows={2} />
          </Field>
        </div>
        <PermissionPicker catalog={catalog} selected={selected} onChange={setSelected} />
        <FormError error={error} />
      </form>
    </Dialog>
  );
}

export function RolesTable({ roles, catalog, canWrite }: { roles: RoleRow[]; catalog: PermissionInfo[]; canWrite: boolean }) {
  const router = useRouter();
  const [active, setActive] = React.useState<RoleRow | null>(null);
  const [editing, setEditing] = React.useState(false);
  const [name, setName] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [deleting, setDeleting] = React.useState<RoleRow | null>(null);

  function openRole(r: RoleRow) {
    setActive(r);
    setEditing(false);
    setName(r.name);
    setDescription(r.description);
    setSelected(new Set(r.permissions.includes("*") ? catalog.map((p) => p.key) : r.permissions));
    setError(null);
  }

  const columns: ColumnDef<RoleRow, unknown>[] = [
    { id: "name", header: "Role", enableHiding: false, cell: ({ row }) => (
      <span className="flex items-center gap-2">
        <span className="font-medium">{row.original.name}</span>
        {row.original.isSystem ? <Badge tone="info">System</Badge> : <Badge>Custom</Badge>}
      </span>
    ) },
    { id: "key", header: "Key", cell: ({ row }) => <span className="font-mono text-xs">{row.original.key}</span> },
    { id: "description", header: "Description", cell: ({ row }) => <span className="text-fg-muted">{row.original.description}</span> },
    { id: "members", header: "Members", accessorKey: "memberCount", meta: { align: "end", width: 90 } },
    { id: "permissions", header: "Permissions", meta: { align: "end", width: 110 }, cell: ({ row }) => (row.original.permissions.includes("*") ? `All (${catalog.length})` : row.original.permissions.length) },
  ];

  const wildcard = active?.permissions.includes("*") ?? false;

  return (
    <>
      <DataTable columns={columns} data={roles} getRowId={(r) => r.id} onRowClick={openRole} columnVisibilityMenu={false} caption="Roles" emptyState={<EmptyState icon={ShieldCheck} title="No roles" />} />
      <Sheet
        open={active !== null}
        onOpenChange={(o) => !o && setActive(null)}
        title={active?.name ?? ""}
        description={active ? `${active.key} · ${active.memberCount} member${active.memberCount === 1 ? "" : "s"}` : undefined}
        width="lg"
        footer={
          active ? (
            editing ? (
              <>
                <Button variant="ghost" onClick={() => { setEditing(false); openRole(active); }} disabled={pending}>
                  Cancel
                </Button>
                <Button variant="primary" loading={pending} disabled={selected.size === 0 || name.trim().length < 2} onClick={async () => {
                  setPending(true);
                  setError(null);
                  const r = await updateRoleAction(active.id, { name, description, permissions: [...selected] });
                  setPending(false);
                  if (!r.ok) return setError(r.error);
                  toast.success("Role updated");
                  setActive(null);
                  router.refresh();
                }}>
                  Save changes
                </Button>
              </>
            ) : (
              <>
                <Button variant="ghost" className="text-deny" disabled={!canWrite || active.isSystem || active.memberCount > 0} disabledReason={!canWrite ? "Requires users:write" : active.isSystem ? "System roles cannot be deleted" : "Reassign its members first"} onClick={() => setDeleting(active)}>
                  Delete role
                </Button>
                <Button variant="primary" disabled={!canWrite || active.isSystem} disabledReason={!canWrite ? "Requires users:write" : "System roles are read-only. Create a custom role instead."} onClick={() => setEditing(true)}>
                  Edit role
                </Button>
              </>
            )
          ) : null
        }
      >
        {active ? (
          <div className="space-y-4">
            {editing ? (
              <div className="space-y-3">
                <Field label="Name" htmlFor="edit-role-name">
                  <Input id="edit-role-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
                </Field>
                <Field label="Description" htmlFor="edit-role-desc">
                  <Textarea id="edit-role-desc" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={300} rows={2} />
                </Field>
              </div>
            ) : (
              <p className="text-sm text-fg-muted">{active.description || "No description."}</p>
            )}
            {wildcard ? <div className="rounded-md border border-info/30 bg-info/10 px-3 py-2 text-xs text-fg">This role holds the wildcard permission: every current and future permission is granted.</div> : null}
            <PermissionPicker catalog={catalog} selected={selected} onChange={setSelected} readOnly={!editing} />
            <FormError error={error} />
          </div>
        ) : null}
      </Sheet>
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={deleting ? `Delete role ${deleting.name}` : ""}
        description="The role is removed permanently. Members must be reassigned first."
        confirmLabel="Delete role"
        danger
        onConfirm={async () => {
          if (!deleting) return;
          const r = await deleteRoleAction(deleting.id);
          if (!r.ok) return r.error;
          toast.success(`Role ${deleting.name} deleted`);
          setActive(null);
          router.refresh();
        }}
      />
    </>
  );
}
