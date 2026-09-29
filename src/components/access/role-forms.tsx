"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { AlertTriangle, Loader2, Pencil, Plus, RotateCcw, ShieldAlert, Trash2, UserMinus, UserPlus } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { PickerCombobox, type PickerOption } from "@/components/forms/picker-combobox";
import {
  addRoleMemberAction,
  createRoleAction,
  deleteRoleAction,
  removeRoleMemberAction,
  restoreRoleDefaultAction,
  setMemberRolesAction,
  setRolePermissionAction,
  updateRoleDetailsAction,
} from "@/server/access/actions";

export function useAccessError() {
  const t = useTranslations("adminRoles");
  return (code?: string) => (code && t.has(`error.${code}`) ? t(`error.${code}`) : t("error.generic"));
}

export type RoleOption = { id: string; label: string; key?: string };

// ---------------------------------------------------------------------------
// Create and rename
// ---------------------------------------------------------------------------

function DetailsFields({ v, set }: { v: { nameEn: string; nameAr: string; descEn: string; descAr: string }; set: (patch: Partial<{ nameEn: string; nameAr: string; descEn: string; descAr: string }>) => void }) {
  const t = useTranslations("adminRoles");
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="role-name-en">{t("fieldNameEn")}</Label>
          <Input id="role-name-en" dir="ltr" value={v.nameEn} onChange={(e) => set({ nameEn: e.target.value })} data-testid="role-name-en" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="role-name-ar">{t("fieldNameAr")}</Label>
          <Input id="role-name-ar" dir="rtl" value={v.nameAr} onChange={(e) => set({ nameAr: e.target.value })} data-testid="role-name-ar" />
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="role-desc-en">{t("fieldDescEn")}</Label>
          <Textarea id="role-desc-en" dir="ltr" rows={2} value={v.descEn} onChange={(e) => set({ descEn: e.target.value })} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="role-desc-ar">{t("fieldDescAr")}</Label>
          <Textarea id="role-desc-ar" dir="rtl" rows={2} value={v.descAr} onChange={(e) => set({ descAr: e.target.value })} />
        </div>
      </div>
    </div>
  );
}

const NONE = "none";

export function CreateRoleDialog({ roles }: { roles: RoleOption[] }) {
  const t = useTranslations("adminRoles");
  const err = useAccessError();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [v, setV] = useState({ nameEn: "", nameAr: "", descEn: "", descAr: "" });
  const [copyFrom, setCopyFrom] = useState(NONE);
  const submit = () =>
    start(async () => {
      const res = await createRoleAction({ ...v, copyFromRoleId: copyFrom === NONE ? null : copyFrom });
      if (!res.ok) return void toast.error(err(res.error));
      toast.success(t("roleCreated"));
      setOpen(false);
      router.push(`/admin/roles/${res.roleId}`);
    });
  return (
    <>
      <Button onClick={() => setOpen(true)} data-testid="create-role">
        <Plus className="size-4" />
        {t("createRole")}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{t("createRole")}</DialogTitle>
            <DialogDescription>{t("createRoleBody")}</DialogDescription>
          </DialogHeader>
          <DetailsFields v={v} set={(p) => setV((cur) => ({ ...cur, ...p }))} />
          <div className="space-y-1.5">
            <Label>{t("copyFrom")}</Label>
            <Select value={copyFrom} onValueChange={setCopyFrom}>
              <SelectTrigger className="w-full" data-testid="role-copy-from">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>{t("copyFromNone")}</SelectItem>
                {roles.map((r) => (
                  <SelectItem key={r.id} value={r.id}>
                    {r.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">{t("copyFromHint")}</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              {t("cancel")}
            </Button>
            <Button onClick={submit} disabled={pending || v.nameEn.trim().length < 2} data-testid="create-role-save">
              {pending && <Loader2 className="size-4 animate-spin" />}
              {t("createRole")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function RoleDetailsDialog({ role }: { role: { id: string; nameEn: string; nameAr: string; descEn: string; descAr: string; isSystem: boolean } }) {
  const t = useTranslations("adminRoles");
  const err = useAccessError();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [v, setV] = useState({ nameEn: role.nameEn, nameAr: role.nameAr, descEn: role.descEn, descAr: role.descAr });
  const submit = () =>
    start(async () => {
      const res = await updateRoleDetailsAction({ ...v, roleId: role.id });
      if (!res.ok) return void toast.error(err(res.error));
      toast.success(t("saved"));
      setOpen(false);
      router.refresh();
    });
  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)} data-testid="rename-role">
        <Pencil className="size-4" />
        {t("rename")}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{t("renameTitle")}</DialogTitle>
            <DialogDescription>{role.isSystem ? t("renameBuiltInBody") : t("renameBody")}</DialogDescription>
          </DialogHeader>
          <DetailsFields v={v} set={(p) => setV((cur) => ({ ...cur, ...p }))} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              {t("cancel")}
            </Button>
            <Button onClick={submit} disabled={pending || v.nameEn.trim().length < 2} data-testid="rename-role-save">
              {pending && <Loader2 className="size-4 animate-spin" />}
              {t("save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function RestoreDefaultButton({ roleId }: { roleId: string }) {
  const t = useTranslations("adminRoles");
  const err = useAccessError();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const submit = () =>
    start(async () => {
      const res = await restoreRoleDefaultAction(roleId);
      if (!res.ok) return void toast.error(err(res.error));
      toast.success(t("restored"));
      setOpen(false);
      router.refresh();
    });
  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)} data-testid="restore-default">
        <RotateCcw className="size-4" />
        {t("restoreDefault")}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("restoreTitle")}</DialogTitle>
            <DialogDescription>{t("restoreBody")}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              {t("cancel")}
            </Button>
            <Button onClick={submit} disabled={pending} data-testid="restore-default-confirm">
              {pending && <Loader2 className="size-4 animate-spin" />}
              {t("restoreDefault")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function DeleteRoleDialog({ roleId, memberCount, targets }: { roleId: string; memberCount: number; targets: RoleOption[] }) {
  const t = useTranslations("adminRoles");
  const err = useAccessError();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [target, setTarget] = useState(NONE);
  const needsTarget = memberCount > 0;
  const submit = () =>
    start(async () => {
      const res = await deleteRoleAction({ roleId, moveToRoleId: target === NONE ? null : target });
      if (!res.ok) return void toast.error(err(res.error));
      toast.success(t("deleted"));
      setOpen(false);
      router.push("/admin/roles");
    });
  return (
    <>
      <Button variant="outline" size="sm" className="text-danger hover:text-danger" onClick={() => setOpen(true)} data-testid="delete-role">
        <Trash2 className="size-4" />
        {t("delete")}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("deleteTitle")}</DialogTitle>
            <DialogDescription>{needsTarget ? t("deleteMoveBody", { count: memberCount }) : t("deleteBody")}</DialogDescription>
          </DialogHeader>
          {needsTarget && (
            <div className="space-y-1.5">
              <Label>{t("moveMembersTo")}</Label>
              <Select value={target} onValueChange={setTarget}>
                <SelectTrigger className="w-full" data-testid="delete-move-to">
                  <SelectValue placeholder={t("chooseRole")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE} disabled>
                    {t("chooseRole")}
                  </SelectItem>
                  {targets.map((r) => (
                    <SelectItem key={r.id} value={r.id}>
                      {r.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              {t("cancel")}
            </Button>
            <Button variant="destructive" onClick={submit} disabled={pending || (needsTarget && target === NONE)} data-testid="delete-role-confirm">
              {pending && <Loader2 className="size-4 animate-spin" />}
              {t("delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ---------------------------------------------------------------------------
// Permission toggle with typed confirmation for sensitive permissions
// ---------------------------------------------------------------------------

export function PermissionSwitch({
  roleId,
  roleName,
  permission,
  label,
  granted,
  sensitive,
}: {
  roleId: string;
  roleName: string;
  permission: string;
  label: string;
  granted: boolean;
  sensitive: boolean;
}) {
  const t = useTranslations("adminRoles");
  const err = useAccessError();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [optimistic, setOptimistic] = useState<boolean | null>(null);
  const value = optimistic ?? granted;

  const save = (next: boolean, confirmText?: string) =>
    start(async () => {
      setOptimistic(next);
      const res = await setRolePermissionAction({ roleId, permission, granted: next, confirmText: confirmText ?? null });
      if (!res.ok) {
        setOptimistic(null);
        return void toast.error(err(res.error));
      }
      setConfirmOpen(false);
      setTyped("");
      toast.success(next ? t("granted", { permission: label }) : t("removed", { permission: label }));
      router.refresh();
      setOptimistic(null);
    });

  return (
    <>
      <Switch
        checked={value}
        disabled={pending}
        aria-label={label}
        data-testid={`perm-${permission}`}
        onCheckedChange={(next) => {
          if (next && sensitive) {
            setConfirmOpen(true);
            return;
          }
          save(next);
        }}
      />
      <Dialog open={confirmOpen} onOpenChange={(o) => { setConfirmOpen(o); if (!o) setTyped(""); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShieldAlert className="size-5 text-danger" />
              {t("sensitiveTitle")}
            </DialogTitle>
            <DialogDescription>{t("sensitiveBody", { permission: label, role: roleName })}</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor={`confirm-${permission}`}>{t("typeToConfirm", { role: roleName })}</Label>
            <Input id={`confirm-${permission}`} value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" data-testid="sensitive-confirm-input" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>
              {t("cancel")}
            </Button>
            <Button variant="destructive" disabled={pending || typed.trim().length === 0} onClick={() => save(true, typed)} data-testid="sensitive-confirm">
              {pending && <Loader2 className="size-4 animate-spin" />}
              {t("grantAccess")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ---------------------------------------------------------------------------
// Role members
// ---------------------------------------------------------------------------

export function AddRoleMember({ roleId, candidates, sensitive }: { roleId: string; candidates: PickerOption[]; sensitive: boolean }) {
  const t = useTranslations("adminRoles");
  const err = useAccessError();
  const router = useRouter();
  const [value, setValue] = useState("");
  const [ack, setAck] = useState(false);
  const [pending, start] = useTransition();
  const add = () =>
    start(async () => {
      const res = await addRoleMemberAction({ roleId, membershipId: value, confirmSensitive: ack });
      if (!res.ok) return void toast.error(err(res.error));
      toast.success(t("memberAdded"));
      setValue("");
      setAck(false);
      router.refresh();
    });
  return (
    <div className="space-y-2">
      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="min-w-0 flex-1">
          <PickerCombobox options={candidates} value={value} onChange={setValue} placeholder={t("searchStaff")} testId="add-member-picker" />
        </div>
        <Button onClick={add} disabled={pending || !value || (sensitive && !ack)} data-testid="add-member">
          {pending ? <Loader2 className="size-4 animate-spin" /> : <UserPlus className="size-4" />}
          {t("addMember")}
        </Button>
      </div>
      {sensitive && value && (
        <label className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning-soft/50 p-3 text-sm">
          <Checkbox checked={ack} onCheckedChange={(c) => setAck(!!c)} className="mt-0.5" data-testid="add-member-ack" />
          <span>{t("sensitiveMemberAck")}</span>
        </label>
      )}
    </div>
  );
}

export function RemoveRoleMember({ roleId, membershipId, name, lock }: { roleId: string; membershipId: string; name: string; lock: string | null }) {
  const t = useTranslations("adminRoles");
  const err = useAccessError();
  const router = useRouter();
  const [pending, start] = useTransition();
  const remove = () =>
    start(async () => {
      const res = await removeRoleMemberAction({ roleId, membershipId });
      if (!res.ok) return void toast.error(err(res.error));
      toast.success(t("memberRemoved", { name }));
      router.refresh();
    });
  const btn = (
    <Button variant="ghost" size="sm" onClick={remove} disabled={pending || !!lock} aria-label={t("removeMember", { name })} data-testid="remove-member">
      {pending ? <Loader2 className="size-4 animate-spin" /> : <UserMinus className="size-4" />}
      <span className="hidden sm:inline">{t("remove")}</span>
    </Button>
  );
  if (!lock) return btn;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span tabIndex={0}>{btn}</span>
      </TooltipTrigger>
      <TooltipContent>{lock}</TooltipContent>
    </Tooltip>
  );
}

// ---------------------------------------------------------------------------
// Roles control on the people page
// ---------------------------------------------------------------------------

export type MemberRoleOption = { id: string; label: string; description: string; sensitive: boolean };

export function MemberRolesDialog({ membershipId, name, roles, current }: { membershipId: string; name: string; roles: MemberRoleOption[]; current: string[] }) {
  const t = useTranslations("adminRoles");
  const err = useAccessError();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState<string[]>(current);
  const [ack, setAck] = useState(false);
  const [pending, start] = useTransition();
  const addsSensitive = roles.some((r) => r.sensitive && value.includes(r.id) && !current.includes(r.id));
  const save = () =>
    start(async () => {
      const res = await setMemberRolesAction({ membershipId, roleIds: value, confirmSensitive: ack });
      if (!res.ok) return void toast.error(err(res.error));
      toast.success(t("rolesSaved", { name }));
      setOpen(false);
      router.refresh();
    });
  return (
    <>
      <Button variant="outline" size="sm" onClick={() => { setValue(current); setAck(false); setOpen(true); }} data-testid="member-roles">
        <ShieldAlert className="size-4" />
        {t("rolesButton")}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t("memberRolesTitle", { name })}</DialogTitle>
            <DialogDescription>{t("memberRolesBody")}</DialogDescription>
          </DialogHeader>
          <div className="grid max-h-80 gap-1 overflow-y-auto rounded-lg border p-2 sm:grid-cols-2">
            {roles.map((r) => (
              <label key={r.id} className="flex cursor-pointer items-start gap-2 rounded-md p-1.5 hover:bg-muted/50" data-testid={`member-role-${r.id}`}>
                <Checkbox className="mt-0.5" checked={value.includes(r.id)} onCheckedChange={(c) => setValue((v) => (c ? [...v, r.id] : v.filter((x) => x !== r.id)))} />
                <span className="min-w-0">
                  <span className="flex items-center gap-1.5 text-sm font-medium">
                    {r.label}
                    {r.sensitive && <ShieldAlert className="size-3.5 text-danger" aria-label={t("sensitiveBadge")} />}
                  </span>
                  <span className="block text-xs text-muted-foreground">{r.description}</span>
                </span>
              </label>
            ))}
          </div>
          {value.length === 0 && (
            <Alert>
              <AlertTriangle className="size-4" />
              <AlertDescription>{t("atLeastOneRole")}</AlertDescription>
            </Alert>
          )}
          {addsSensitive && (
            <label className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning-soft/50 p-3 text-sm">
              <Checkbox checked={ack} onCheckedChange={(c) => setAck(!!c)} className="mt-0.5" data-testid="member-roles-ack" />
              <span>{t("sensitiveMemberAck")}</span>
            </label>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              {t("cancel")}
            </Button>
            <Button onClick={save} disabled={pending || value.length === 0 || (addsSensitive && !ack)} data-testid="member-roles-save">
              {pending && <Loader2 className="size-4 animate-spin" />}
              {t("save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Person picker for the access check tab: navigates with ?person=. */
export function AccessCheckPicker({ options, value }: { options: PickerOption[]; value: string }) {
  const t = useTranslations("adminRoles");
  const router = useRouter();
  return (
    <div className="max-w-md">
      <PickerCombobox options={options} value={value} onChange={(v) => router.push(`/admin/roles?tab=check&person=${v}`)} placeholder={t("pickPerson")} testId="access-check-picker" />
    </div>
  );
}
