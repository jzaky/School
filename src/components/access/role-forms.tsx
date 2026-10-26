"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { AlertTriangle, CalendarClock, Info, Loader2, Lock, Pencil, Plus, RotateCcw, ShieldAlert, Trash2, UserMinus, UserPlus } from "lucide-react";
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
import { SearchPicker } from "@/components/forms/search-picker";
import { searchMembersAction, type PickHit } from "@/server/people/search-actions";
import {
  addRoleMemberAction,
  createRoleAction,
  deleteRoleAction,
  removeRoleMemberAction,
  restoreRoleDefaultAction,
  setAssignmentEndAction,
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

/** Wraps a disabled control in a tooltip that says why it cannot be used. */
function Locked({ reason, children }: { reason: string | null | undefined; children: React.ReactElement }) {
  if (!reason) return children;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span tabIndex={0} className="inline-flex" data-testid="locked-control">
          {children}
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs">{reason}</TooltipContent>
    </Tooltip>
  );
}

export function RestoreDefaultButton({ roleId, blocked }: { roleId: string; blocked?: string | null }) {
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
      <Locked reason={blocked}>
        <Button variant="outline" size="sm" onClick={() => setOpen(true)} disabled={!!blocked} data-testid="restore-default">
          {blocked ? <Lock className="size-4" /> : <RotateCcw className="size-4" />}
          {t("restoreDefault")}
        </Button>
      </Locked>
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

export function DeleteRoleDialog({ roleId, memberCount, targets, hiddenNote }: { roleId: string; memberCount: number; targets: RoleOption[]; hiddenNote?: string | null }) {
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
              {hiddenNote && <p className="text-xs text-muted-foreground">{hiddenNote}</p>}
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
  selfBlocked,
}: {
  roleId: string;
  roleName: string;
  permission: string;
  label: string;
  granted: boolean;
  sensitive: boolean;
  /** Why the viewer cannot switch this on (they hold the role and would gain sensitive access). */
  selfBlocked?: string | null;
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

  const blocked = !value && selfBlocked ? selfBlocked : null;
  return (
    <>
      <Locked reason={blocked}>
        <Switch
          checked={value}
          disabled={pending || !!blocked}
          aria-label={label}
          data-testid={`perm-${permission}`}
          data-self-blocked={blocked ? "yes" : undefined}
          onCheckedChange={(next) => {
            if (next && sensitive) {
              setConfirmOpen(true);
              return;
            }
            save(next);
          }}
        />
      </Locked>
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

export function AddRoleMember({
  roleId,
  candidates,
  sensitive,
  today,
  maxDay,
  selfNote,
}: {
  roleId: string;
  candidates: PickerOption[];
  sensitive: boolean;
  /** Earliest and latest "until" day (YYYY-MM-DD, school time zone). */
  today: string;
  maxDay: string;
  /** Shown when the viewer is left out of the picker because the role would raise their own access. */
  selfNote?: string | null;
}) {
  const t = useTranslations("adminRoles");
  const err = useAccessError();
  const router = useRouter();
  const [value, setValue] = useState("");
  const [until, setUntil] = useState("");
  const [ack, setAck] = useState(false);
  const [pending, start] = useTransition();
  const add = () =>
    start(async () => {
      const res = await addRoleMemberAction({ roleId, membershipId: value, confirmSensitive: ack, until: until || null });
      if (!res.ok) return void toast.error(err(res.error));
      toast.success(until ? t("memberAddedUntil") : t("memberAdded"));
      setValue("");
      setUntil("");
      setAck(false);
      router.refresh();
    });
  return (
    <div className="space-y-2">
      <div className="min-w-0">
        <PickerCombobox options={candidates} value={value} onChange={setValue} placeholder={t("searchStaff")} testId="add-member-picker" />
      </div>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <div className="min-w-0 flex-1 space-y-1">
          <Label htmlFor={`until-${roleId}`} className="text-xs">
            {t("untilLabel")}
          </Label>
          <Input id={`until-${roleId}`} type="date" min={today} max={maxDay} value={until} onChange={(e) => setUntil(e.target.value)} className="w-full" dir="ltr" data-testid="add-member-until" />
        </div>
        <Button onClick={add} disabled={pending || !value || (sensitive && !ack)} data-testid="add-member">
          {pending ? <Loader2 className="size-4 animate-spin" /> : <UserPlus className="size-4" />}
          {t("addMember")}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">{t("untilHelp")}</p>
      {sensitive && value && (
        <label className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning-soft/50 p-3 text-sm">
          <Checkbox checked={ack} onCheckedChange={(c) => setAck(!!c)} className="mt-0.5" data-testid="add-member-ack" />
          <span>{t("sensitiveMemberAck")}</span>
        </label>
      )}
      {selfNote && (
        <p className="flex items-start gap-2 rounded-lg border bg-muted/40 p-3 text-xs text-muted-foreground" data-testid="self-note">
          <Lock className="mt-0.5 size-3.5 shrink-0" />
          <span>{selfNote}</span>
        </p>
      )}
    </div>
  );
}

/**
 * Change when someone's role ends: extend it, end it earlier, or remove the end date. `maxDay` limits how
 * far it can go (the viewer's own sensitive access can only be shortened); `allowNoEnd` offers "no end date".
 */
export function AssignmentEndButton({
  roleId,
  membershipId,
  name,
  roleName,
  until,
  today,
  maxDay,
  allowNoEnd,
  lock,
  note,
}: {
  roleId: string;
  membershipId: string;
  name: string;
  roleName: string;
  until: string | null;
  today: string;
  maxDay: string;
  allowNoEnd: boolean;
  lock?: string | null;
  note?: string | null;
}) {
  const t = useTranslations("adminRoles");
  const err = useAccessError();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [day, setDay] = useState(until ?? "");
  const [pending, start] = useTransition();
  const save = (next: string | null) =>
    start(async () => {
      const res = await setAssignmentEndAction({ roleId, membershipId, until: next });
      if (!res.ok) return void toast.error(err(res.error));
      toast.success(next ? t("endDateSaved") : t("endDateRemoved"));
      setOpen(false);
      router.refresh();
    });
  return (
    <>
      <Locked reason={lock}>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setDay(until ?? "");
            setOpen(true);
          }}
          disabled={!!lock}
          aria-label={until ? t("changeEndFor", { name }) : t("setEndFor", { name })}
          data-testid="assignment-end"
        >
          <CalendarClock className="size-4" />
          <span>{until ? t("changeEnd") : t("setEnd")}</span>
        </Button>
      </Locked>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("endDateTitle", { name })}</DialogTitle>
            <DialogDescription>{t("endDateBody", { name, role: roleName })}</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor={`end-${roleId}-${membershipId}`}>{t("endDateField")}</Label>
            <Input id={`end-${roleId}-${membershipId}`} type="date" min={today} max={maxDay} value={day} onChange={(e) => setDay(e.target.value)} dir="ltr" data-testid="assignment-end-date" />
            <p className="text-xs text-muted-foreground">{t("untilHelp")}</p>
          </div>
          {note && (
            <p className="flex items-start gap-2 rounded-lg border bg-muted/40 p-3 text-xs text-muted-foreground" data-testid="assignment-end-note">
              <Info className="mt-0.5 size-3.5 shrink-0" />
              <span>{note}</span>
            </p>
          )}
          <DialogFooter className="gap-2">
            {allowNoEnd && until && (
              <Button variant="outline" onClick={() => save(null)} disabled={pending} data-testid="assignment-end-clear">
                {t("removeEndDate")}
              </Button>
            )}
            <Button onClick={() => save(day)} disabled={pending || !day || day === until || day < today || day > maxDay} data-testid="assignment-end-save">
              {pending && <Loader2 className="size-4 animate-spin" />}
              {t("save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function RemoveRoleMember({ roleId, membershipId, name, lock, timeLimited }: { roleId: string; membershipId: string; name: string; lock: string | null; timeLimited?: boolean }) {
  const t = useTranslations("adminRoles");
  const err = useAccessError();
  const router = useRouter();
  const [pending, start] = useTransition();
  const remove = () =>
    start(async () => {
      const res = await removeRoleMemberAction({ roleId, membershipId });
      if (!res.ok) return void toast.error(err(res.error));
      toast.success(timeLimited ? t("accessEnded", { name }) : t("memberRemoved", { name }));
      router.refresh();
    });
  const btn = (
    <Button variant="ghost" size="sm" onClick={remove} disabled={pending || !!lock} aria-label={timeLimited ? t("endNowFor", { name }) : t("removeMember", { name })} data-testid="remove-member">
      {pending ? <Loader2 className="size-4 animate-spin" /> : <UserMinus className="size-4" />}
      <span>{timeLimited ? t("endNow") : t("remove")}</span>
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

export type MemberRoleOption = { id: string; label: string; description: string; sensitive: boolean; until?: string | null };

export function MemberRolesDialog({ membershipId, name, roles, current, selfBlocked = [] }: { membershipId: string; name: string; roles: MemberRoleOption[]; current: string[]; selfBlocked?: string[] }) {
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
            {roles.map((r) => {
              const blocked = selfBlocked.includes(r.id) && !current.includes(r.id);
              const row = (
                <label key={r.id} className="flex cursor-pointer items-start gap-2 rounded-md p-1.5 hover:bg-muted/50 has-disabled:cursor-not-allowed has-disabled:opacity-60" data-testid={`member-role-${r.id}`}>
                  <Checkbox className="mt-0.5" disabled={blocked} checked={value.includes(r.id)} onCheckedChange={(c) => setValue((v) => (c ? [...v, r.id] : v.filter((x) => x !== r.id)))} />
                  <span className="min-w-0">
                    <span className="flex flex-wrap items-center gap-1.5 text-sm font-medium">
                      {r.label}
                      {r.sensitive && <ShieldAlert className="size-3.5 text-danger" aria-label={t("sensitiveBadge")} />}
                      {blocked && <Lock className="size-3.5 text-muted-foreground" aria-label={t("selfBlockedRole")} />}
                      {r.until && current.includes(r.id) && <span className="text-xs font-normal text-muted-foreground">{t("untilShort", { date: r.until })}</span>}
                    </span>
                    <span className="block text-xs text-muted-foreground">{r.description}</span>
                  </span>
                </label>
              );
              if (!blocked) return row;
              return (
                <Tooltip key={r.id}>
                  <TooltipTrigger asChild>
                    <div>{row}</div>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-xs">{t("selfBlockedRole")}</TooltipContent>
                </Tooltip>
              );
            })}
          </div>
          {selfBlocked.some((id) => !current.includes(id)) && (
            <p className="flex items-start gap-2 text-xs text-muted-foreground" data-testid="member-roles-self-note">
              <Lock className="mt-0.5 size-3.5 shrink-0" />
              <span>{t("selfBlockedRolesNote")}</span>
            </p>
          )}
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

/** Person picker for the access check tab: searches everyone on the server and navigates with ?person=. */
export function AccessCheckPicker({ selected, value }: { selected: PickHit | null; value: string }) {
  const t = useTranslations("adminRoles");
  const router = useRouter();
  return (
    <div className="max-w-md">
      <SearchPicker search={(q) => searchMembersAction({ q })} value={value} selected={selected} onChange={(v) => router.push(`/admin/roles?tab=check&person=${v}`)} placeholder={t("pickPerson")} testId="access-check-picker" />
    </div>
  );
}
