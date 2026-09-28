"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Loader2, Pencil, UserCheck, UserPlus, UserX } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { addStaffAction, setMemberStatusAction, updateStaffAction } from "@/server/admin/people-actions";

export type RoleOption = { key: string; label: string; description: string };
export type DeptOption = { id: string; label: string };
type AdminLock = "self" | "last" | "permission" | null;
const NO_DEPT = "none";
const ADMIN = "school_admin";

export function usePeopleError() {
  const t = useTranslations("adminPeople");
  return (code?: string) => (code && t.has(`error.${code}`) ? t(`error.${code}`) : t("error.generic"));
}

function RoleChecklist({ roles, value, onChange, lockedKey, lockReason }: { roles: RoleOption[]; value: string[]; onChange: (v: string[]) => void; lockedKey?: string; lockReason?: string }) {
  return (
    <div className="grid max-h-64 gap-1 overflow-y-auto rounded-lg border p-2 sm:grid-cols-2">
      {roles.map((r) => {
        const locked = r.key === lockedKey;
        const checked = value.includes(r.key);
        const row = (
          <label className="flex cursor-pointer items-start gap-2 rounded-md p-1.5 hover:bg-muted/50 has-disabled:cursor-not-allowed has-disabled:opacity-60" data-testid={`role-${r.key}`}>
            <Checkbox
              className="mt-0.5"
              checked={checked}
              disabled={locked}
              onCheckedChange={(c) => onChange(c ? [...value, r.key] : value.filter((k) => k !== r.key))}
            />
            <span className="min-w-0">
              <span className="block text-sm font-medium">{r.label}</span>
              <span className="block text-xs text-muted-foreground">{r.description}</span>
            </span>
          </label>
        );
        if (!locked || !lockReason) return <div key={r.key}>{row}</div>;
        return (
          <Tooltip key={r.key}>
            <TooltipTrigger asChild>
              <div>{row}</div>
            </TooltipTrigger>
            <TooltipContent>{lockReason}</TooltipContent>
          </Tooltip>
        );
      })}
    </div>
  );
}

function DeptSelect({ departments, value, onChange }: { departments: DeptOption[]; value: string | null; onChange: (v: string | null) => void }) {
  const t = useTranslations("adminPeople");
  return (
    <Select value={value ?? NO_DEPT} onValueChange={(v) => onChange(v === NO_DEPT ? null : v)}>
      <SelectTrigger className="w-full" data-testid="staff-department">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NO_DEPT}>{t("noDepartment")}</SelectItem>
        {departments.map((d) => (
          <SelectItem key={d.id} value={d.id}>
            {d.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function TitleFields({ titleEn, titleAr, setTitleEn, setTitleAr }: { titleEn: string; titleAr: string; setTitleEn: (v: string) => void; setTitleAr: (v: string) => void }) {
  const t = useTranslations("adminPeople");
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="space-y-1.5">
        <Label htmlFor="staff-title-en">{t("fieldTitleEn")}</Label>
        <Input id="staff-title-en" value={titleEn} onChange={(e) => setTitleEn(e.target.value)} dir="ltr" data-testid="staff-title-en" />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="staff-title-ar">{t("fieldTitleAr")}</Label>
        <Input id="staff-title-ar" value={titleAr} onChange={(e) => setTitleAr(e.target.value)} dir="rtl" placeholder={t("optional")} />
      </div>
    </div>
  );
}

export function AddStaffDialog({ roles, departments, canAssignAdmin }: { roles: RoleOption[]; departments: DeptOption[]; canAssignAdmin: boolean }) {
  const t = useTranslations("adminPeople");
  const err = usePeopleError();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [email, setEmail] = useState("");
  const [nameEn, setNameEn] = useState("");
  const [nameAr, setNameAr] = useState("");
  const [titleEn, setTitleEn] = useState("");
  const [titleAr, setTitleAr] = useState("");
  const [departmentId, setDepartmentId] = useState<string | null>(null);
  const [roleKeys, setRoleKeys] = useState<string[]>(["teacher"]);
  const [status, setStatus] = useState<"ACTIVE" | "INVITED">("ACTIVE");

  const reset = () => {
    setEmail("");
    setNameEn("");
    setNameAr("");
    setTitleEn("");
    setTitleAr("");
    setDepartmentId(null);
    setRoleKeys(["teacher"]);
    setStatus("ACTIVE");
  };
  const valid = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim()) && nameEn.trim().length >= 2 && roleKeys.length > 0;

  const submit = () =>
    start(async () => {
      const res = await addStaffAction({ email, nameEn, nameAr, titleEn, titleAr, departmentId, roleKeys, status });
      if (!res.ok) return void toast.error(err(res.error));
      toast.success(t("staffAdded", { name: nameEn.trim() }));
      setOpen(false);
      reset();
      router.refresh();
    });

  return (
    <>
      <Button onClick={() => setOpen(true)} data-testid="add-staff">
        <UserPlus className="size-4" />
        {t("addStaff")}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t("addStaffTitle")}</DialogTitle>
            <DialogDescription>{t("addStaffBody")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="staff-email">{t("fieldEmail")}</Label>
              <Input id="staff-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} dir="ltr" autoComplete="off" data-testid="staff-email" />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="staff-name-en">{t("fieldNameEn")}</Label>
                <Input id="staff-name-en" value={nameEn} onChange={(e) => setNameEn(e.target.value)} dir="ltr" data-testid="staff-name-en" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="staff-name-ar">{t("fieldNameAr")}</Label>
                <Input id="staff-name-ar" value={nameAr} onChange={(e) => setNameAr(e.target.value)} dir="rtl" data-testid="staff-name-ar" />
              </div>
            </div>
            <TitleFields titleEn={titleEn} titleAr={titleAr} setTitleEn={setTitleEn} setTitleAr={setTitleAr} />
            <div className="space-y-1.5">
              <Label>{t("fieldDepartment")}</Label>
              <DeptSelect departments={departments} value={departmentId} onChange={setDepartmentId} />
            </div>
            <div className="space-y-1.5">
              <Label>{t("fieldRoles")}</Label>
              <RoleChecklist roles={roles} value={roleKeys} onChange={setRoleKeys} lockedKey={canAssignAdmin ? undefined : ADMIN} lockReason={t("lockPermission")} />
            </div>
            <div className="space-y-1.5">
              <Label>{t("fieldAccess")}</Label>
              <RadioGroup value={status} onValueChange={(v) => setStatus(v as "ACTIVE" | "INVITED")} className="gap-2 sm:grid-cols-2">
                {(["ACTIVE", "INVITED"] as const).map((s) => (
                  <label key={s} className="flex cursor-pointer items-start gap-2 rounded-lg border p-3 has-data-[state=checked]:border-brand has-data-[state=checked]:bg-brand-soft/40">
                    <RadioGroupItem value={s} className="mt-0.5" data-testid={`staff-status-${s}`} />
                    <span>
                      <span className="block text-sm font-medium">{t(`accessOption.${s}`)}</span>
                      <span className="block text-xs text-muted-foreground">{t(`accessHint.${s}`)}</span>
                    </span>
                  </label>
                ))}
              </RadioGroup>
            </div>
            <Alert>
              <AlertDescription>{t("signInNote")}</AlertDescription>
            </Alert>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              {t("cancel")}
            </Button>
            <Button onClick={submit} disabled={pending || !valid} data-testid="staff-save">
              {pending && <Loader2 className="size-4 animate-spin" />}
              {t("addStaff")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function EditStaffDialog({
  member,
  roles,
  departments,
  adminLock,
}: {
  member: { id: string; name: string; roleKeys: string[]; departmentId: string | null; titleEn: string; titleAr: string };
  roles: RoleOption[];
  departments: DeptOption[];
  adminLock: AdminLock;
}) {
  const t = useTranslations("adminPeople");
  const err = usePeopleError();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [roleKeys, setRoleKeys] = useState(member.roleKeys);
  const [departmentId, setDepartmentId] = useState(member.departmentId);
  const [titleEn, setTitleEn] = useState(member.titleEn);
  const [titleAr, setTitleAr] = useState(member.titleAr);
  // The admin role is locked when removing it would leave the school without an administrator, when it is
  // the editor's own admin role, or when the editor cannot manage administrators.
  const lockReason = adminLock === "self" ? t("lockSelf") : adminLock === "last" ? t("lockLast") : adminLock === "permission" ? t("lockPermission") : undefined;

  const openDialog = () => {
    setRoleKeys(member.roleKeys);
    setDepartmentId(member.departmentId);
    setTitleEn(member.titleEn);
    setTitleAr(member.titleAr);
    setOpen(true);
  };
  const submit = () =>
    start(async () => {
      const res = await updateStaffAction({ membershipId: member.id, roleKeys, departmentId, titleEn, titleAr });
      if (!res.ok) return void toast.error(err(res.error));
      toast.success(t("staffUpdated"));
      setOpen(false);
      router.refresh();
    });

  return (
    <>
      <Button variant="outline" size="sm" onClick={openDialog} data-testid="staff-edit">
        <Pencil className="size-3.5" />
        {t("edit")}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t("editStaffTitle", { name: member.name })}</DialogTitle>
            <DialogDescription>{t("editStaffBody")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <TitleFields titleEn={titleEn} titleAr={titleAr} setTitleEn={setTitleEn} setTitleAr={setTitleAr} />
            <div className="space-y-1.5">
              <Label>{t("fieldDepartment")}</Label>
              <DeptSelect departments={departments} value={departmentId} onChange={setDepartmentId} />
            </div>
            <div className="space-y-1.5">
              <Label>{t("fieldRoles")}</Label>
              <RoleChecklist roles={roles} value={roleKeys} onChange={setRoleKeys} lockedKey={adminLock ? ADMIN : undefined} lockReason={lockReason} />
              {roleKeys.length === 0 && <p className="text-xs text-danger">{t("rolesRequired")}</p>}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              {t("cancel")}
            </Button>
            <Button onClick={submit} disabled={pending || roleKeys.length === 0} data-testid="staff-update">
              {pending && <Loader2 className="size-4 animate-spin" />}
              {t("save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function MemberStatusButton({ membershipId, name, status, blocked }: { membershipId: string; name: string; status: "ACTIVE" | "INVITED" | "SUSPENDED"; blocked: AdminLock }) {
  const t = useTranslations("adminPeople");
  const err = usePeopleError();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const next = status === "ACTIVE" ? "SUSPENDED" : "ACTIVE";
  const label = status === "ACTIVE" ? t("suspend") : status === "INVITED" ? t("activate") : t("reactivate");
  const isBlocked = !!blocked;
  const reason = blocked === "self" ? t("lockSelfStatus") : blocked === "last" ? t("lockLastStatus") : t("lockPermission");

  const button = (
    <Button variant={next === "SUSPENDED" ? "ghost" : "outline"} size="sm" disabled={isBlocked || pending} onClick={() => setOpen(true)} data-testid={next === "SUSPENDED" ? "staff-suspend" : "staff-activate"} className={next === "SUSPENDED" ? "text-danger hover:text-danger" : undefined}>
      {next === "SUSPENDED" ? <UserX className="size-3.5" /> : <UserCheck className="size-3.5" />}
      {label}
    </Button>
  );
  const confirm = () =>
    start(async () => {
      const res = await setMemberStatusAction({ membershipId, status: next });
      if (!res.ok) return void toast.error(err(res.error));
      toast.success(next === "SUSPENDED" ? t("suspended", { name }) : t("activated", { name }));
      setOpen(false);
      router.refresh();
    });

  return (
    <>
      {isBlocked ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <span tabIndex={0}>{button}</span>
          </TooltipTrigger>
          <TooltipContent>{reason}</TooltipContent>
        </Tooltip>
      ) : (
        button
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{next === "SUSPENDED" ? t("suspendTitle", { name }) : t("activateTitle", { name })}</DialogTitle>
            <DialogDescription>{next === "SUSPENDED" ? t("suspendBody") : t("activateBody")}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              {t("cancel")}
            </Button>
            <Button variant={next === "SUSPENDED" ? "destructive" : "default"} onClick={confirm} disabled={pending} data-testid="status-confirm">
              {pending && <Loader2 className="size-4 animate-spin" />}
              {label}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
