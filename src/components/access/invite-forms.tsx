"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import Papa from "papaparse";
import { toast } from "sonner";
import { Check, Copy, FileSpreadsheet, Link2, Loader2, Mail, RefreshCw, Send, Trash2, UserPlus, Users, X } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { PickerCombobox, type PickerOption } from "@/components/forms/picker-combobox";
import { encodeQr, qrSvgPath } from "@/server/access/qr";
import {
  createStaffLinkAction,
  inviteAllFamiliesAction,
  inviteParentAction,
  inviteStaffAction,
  inviteStudentAction,
  regenerateJoinCodeAction,
  resendInvitationAction,
  revokeInvitationAction,
} from "@/server/access/actions";

export type RoleChoice = { key: string; label: string; description: string };
export type DeptChoice = { id: string; label: string };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function useInviteError() {
  const t = useTranslations("adminInvites");
  return (code?: string) => (code && t.has(`error.${code}`) ? t(`error.${code}`) : t("error.generic"));
}

export function useJoinUrl() {
  const locale = useLocale();
  return (token: string) => (typeof window === "undefined" ? `/${locale}/join/${token}` : `${window.location.origin}/${locale}/join/${token}`);
}

export function CopyField({ value, testId }: { value: string; testId?: string }) {
  const t = useTranslations("adminInvites");
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error(t("copyFailed"));
    }
  };
  return (
    <div className="flex gap-2">
      <Input readOnly value={value} dir="ltr" className="font-mono text-xs" onFocus={(e) => e.currentTarget.select()} data-testid={testId} />
      <Button type="button" variant="outline" size="icon" onClick={copy} aria-label={t("copy")}>
        {copied ? <Check className="size-4 text-success" /> : <Copy className="size-4" />}
      </Button>
    </div>
  );
}

export function QrCode({ value, size = 168, label }: { value: string; size?: number; label: string }) {
  const qr = useMemo(() => {
    try {
      return qrSvgPath(encodeQr(value));
    } catch {
      return null;
    }
  }, [value]);
  if (!qr) return null;
  return (
    <svg viewBox={`0 0 ${qr.size} ${qr.size}`} width={size} height={size} role="img" aria-label={label} className="rounded-lg border bg-white" shapeRendering="crispEdges">
      <path d={qr.path} fill="#000" />
    </svg>
  );
}


function RoleChecks({ roles, value, onChange }: { roles: RoleChoice[]; value: string[]; onChange: (v: string[]) => void }) {
  return (
    <div className="grid max-h-56 gap-1 overflow-y-auto rounded-lg border p-2 sm:grid-cols-2">
      {roles.map((r) => (
        <label key={r.key} className="flex cursor-pointer items-start gap-2 rounded-md p-1.5 hover:bg-muted/50" data-testid={`invite-role-${r.key}`}>
          <Checkbox className="mt-0.5" checked={value.includes(r.key)} onCheckedChange={(c) => onChange(c ? [...value, r.key] : value.filter((k) => k !== r.key))} />
          <span className="min-w-0">
            <span className="block text-sm font-medium">{r.label}</span>
            <span className="block text-xs text-muted-foreground">{r.description}</span>
          </span>
        </label>
      ))}
    </div>
  );
}

function SentPanel({ links, onDone }: { links: Array<{ email: string | null; token: string; emailed: boolean }>; onDone: () => void }) {
  const t = useTranslations("adminInvites");
  const url = useJoinUrl();
  return (
    <div className="space-y-4" data-testid="invite-sent">
      <Alert>
        <Mail className="size-4" />
        <AlertDescription>{t("sentBody")}</AlertDescription>
      </Alert>
      <div className="max-h-72 space-y-3 overflow-y-auto">
        {links.map((l) => (
          <div key={l.token} className="space-y-1">
            <div className="text-xs text-muted-foreground" dir="ltr">
              {l.email}
            </div>
            <CopyField value={url(l.token)} testId="invite-link" />
          </div>
        ))}
      </div>
      <DialogFooter>
        <Button onClick={onDone} data-testid="invite-done">
          {t("done")}
        </Button>
      </DialogFooter>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Invite one person
// ---------------------------------------------------------------------------

export function InviteDialog({ roles, departments, students, accountless }: { roles: RoleChoice[]; departments: DeptChoice[]; students: PickerOption[]; accountless: PickerOption[] }) {
  const t = useTranslations("adminInvites");
  const err = useInviteError();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState("staff");
  const [pending, start] = useTransition();
  const [sent, setSent] = useState<Array<{ email: string | null; token: string; emailed: boolean }> | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [roleKeys, setRoleKeys] = useState<string[]>(["teacher"]);
  const [dept, setDept] = useState("none");
  const [children, setChildren] = useState<string[]>([]);
  const [pick, setPick] = useState("");
  const [studentId, setStudentId] = useState("");

  const reset = () => {
    setSent(null);
    setName("");
    setEmail("");
    setRoleKeys(["teacher"]);
    setDept("none");
    setChildren([]);
    setPick("");
    setStudentId("");
  };
  const okEmail = EMAIL_RE.test(email.trim());
  const valid = tab === "staff" ? okEmail && name.trim().length >= 2 && roleKeys.length > 0 : tab === "parent" ? okEmail && children.length > 0 : okEmail && !!studentId;

  const submit = () =>
    start(async () => {
      const res =
        tab === "staff"
          ? await inviteStaffAction({ rows: [{ nameEn: name, email, roleKeys, department: dept === "none" ? null : dept }] })
          : tab === "parent"
            ? await inviteParentAction({ email, nameEn: name, studentIds: children })
            : await inviteStudentAction({ email, studentId });
      if (!res.ok) return void toast.error(err(res.error));
      const problems = (res as { problems?: Array<{ row: number; code: string }> }).problems ?? [];
      if (problems.length) return void toast.error(err(problems[0].code));
      setSent(res.created);
      router.refresh();
    });

  return (
    <>
      <Button onClick={() => { reset(); setOpen(true); }} data-testid="invite-person">
        <UserPlus className="size-4" />
        {t("invite")}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{sent ? t("sentTitle") : t("inviteTitle")}</DialogTitle>
            {!sent && <DialogDescription>{t("inviteBody")}</DialogDescription>}
          </DialogHeader>
          {sent ? (
            <SentPanel links={sent} onDone={() => setOpen(false)} />
          ) : (
            <>
              <Tabs value={tab} onValueChange={setTab}>
                <TabsList className="w-full">
                  <TabsTrigger value="staff" data-testid="invite-tab-staff">{t("kind.STAFF")}</TabsTrigger>
                  <TabsTrigger value="parent" data-testid="invite-tab-parent">{t("kind.PARENT")}</TabsTrigger>
                  <TabsTrigger value="student" data-testid="invite-tab-student">{t("kind.STUDENT")}</TabsTrigger>
                </TabsList>
                <div className="mt-4 space-y-3">
                  <div className="grid gap-3 sm:grid-cols-2">
                    {tab !== "student" && (
                      <div className="space-y-1.5">
                        <Label htmlFor="invite-name">{tab === "parent" ? t("fieldNameOptional") : t("fieldName")}</Label>
                        <Input id="invite-name" value={name} onChange={(e) => setName(e.target.value)} data-testid="invite-name" />
                      </div>
                    )}
                    <div className="space-y-1.5">
                      <Label htmlFor="invite-email">{t("fieldEmail")}</Label>
                      <Input id="invite-email" type="email" dir="ltr" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" data-testid="invite-email" />
                    </div>
                  </div>
                  <TabsContent value="staff" className="space-y-3">
                    <div className="space-y-1.5">
                      <Label>{t("fieldRoles")}</Label>
                      <RoleChecks roles={roles} value={roleKeys} onChange={setRoleKeys} />
                    </div>
                    <div className="space-y-1.5">
                      <Label>{t("fieldDepartment")}</Label>
                      <Select value={dept} onValueChange={setDept}>
                        <SelectTrigger className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">{t("noDepartment")}</SelectItem>
                          {departments.map((d) => (
                            <SelectItem key={d.id} value={d.id}>
                              {d.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </TabsContent>
                  <TabsContent value="parent" className="space-y-2">
                    <Label>{t("fieldChildren")}</Label>
                    <div className="flex flex-col gap-2 sm:flex-row">
                      <div className="min-w-0 flex-1">
                        <PickerCombobox options={students.filter((s) => !children.includes(s.value))} value={pick} onChange={setPick} placeholder={t("searchStudent")} testId="invite-child-picker" />
                      </div>
                      <Button type="button" variant="outline" disabled={!pick} onClick={() => { setChildren((c) => [...c, pick]); setPick(""); }} data-testid="invite-add-child">
                        {t("addChild")}
                      </Button>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {children.map((id) => (
                        <span key={id} className="inline-flex items-center gap-1 rounded-full bg-brand-soft px-2 py-0.5 text-xs text-brand">
                          {students.find((s) => s.value === id)?.label}
                          <button type="button" onClick={() => setChildren((c) => c.filter((x) => x !== id))} aria-label={t("removeChild")}>
                            <X className="size-3" />
                          </button>
                        </span>
                      ))}
                    </div>
                  </TabsContent>
                  <TabsContent value="student" className="space-y-1.5">
                    <Label>{t("fieldStudent")}</Label>
                    <PickerCombobox options={accountless} value={studentId} onChange={setStudentId} placeholder={t("searchStudent")} testId="invite-student-picker" />
                    {accountless.length === 0 && <p className="text-xs text-muted-foreground">{t("allStudentsHaveAccounts")}</p>}
                  </TabsContent>
                </div>
              </Tabs>
              <DialogFooter>
                <Button variant="outline" onClick={() => setOpen(false)}>
                  {t("cancel")}
                </Button>
                <Button onClick={submit} disabled={pending || !valid} data-testid="invite-send">
                  {pending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
                  {t("send")}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

// ---------------------------------------------------------------------------
// Bulk staff CSV
// ---------------------------------------------------------------------------

type CsvStaff = { nameEn: string; email: string; roleKeys: string[]; department: string | null };

export function parseStaffCsv(text: string): CsvStaff[] {
  const parsed = Papa.parse<Record<string, string>>(text.trim(), { header: true, skipEmptyLines: true, transformHeader: (h) => h.trim().toLowerCase().replace(/\s+/g, "_") });
  return parsed.data.map((r) => ({
    nameEn: (r.name ?? r.name_en ?? r.full_name ?? "").trim(),
    email: (r.email ?? "").trim(),
    roleKeys: (r.roles ?? r.role ?? "").split(/[;|]/).map((x) => x.trim()).filter(Boolean),
    department: (r.department ?? "").trim() || null,
  }));
}

export function BulkStaffDialog() {
  const t = useTranslations("adminInvites");
  const err = useInviteError();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [pending, start] = useTransition();
  const [result, setResult] = useState<{ created: Array<{ email: string | null; token: string; emailed: boolean }>; problems: Array<{ row: number; code: string }> } | null>(null);
  const rows = useMemo(() => (text.trim() ? parseStaffCsv(text) : []), [text]);
  const onFile = async (f: File | undefined) => {
    if (!f) return;
    setText(await f.text());
  };
  const submit = () =>
    start(async () => {
      const res = await inviteStaffAction({ rows });
      if (!res.ok) return void toast.error(err(res.error));
      setResult({ created: res.created, problems: res.problems });
      router.refresh();
    });
  return (
    <>
      <Button variant="outline" onClick={() => { setText(""); setResult(null); setOpen(true); }} data-testid="bulk-staff">
        <FileSpreadsheet className="size-4" />
        {t("bulkStaff")}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t("bulkStaffTitle")}</DialogTitle>
            <DialogDescription>{t("bulkStaffBody")}</DialogDescription>
          </DialogHeader>
          {result ? (
            <div className="space-y-3" data-testid="bulk-result">
              <p className="text-sm">{t("bulkDone", { created: result.created.length, failed: result.problems.length })}</p>
              {result.problems.length > 0 && (
                <ul className="max-h-40 space-y-1 overflow-y-auto rounded-lg border p-2 text-xs">
                  {result.problems.map((p) => (
                    <li key={`${p.row}-${p.code}`}>{t("rowProblem", { row: p.row, problem: err(p.code) })}</li>
                  ))}
                </ul>
              )}
              <DialogFooter>
                <Button onClick={() => setOpen(false)}>{t("done")}</Button>
              </DialogFooter>
            </div>
          ) : (
            <>
              <div className="space-y-2">
                <Input type="file" accept=".csv,text/csv" onChange={(e) => onFile(e.target.files?.[0])} data-testid="bulk-file" />
                <Textarea rows={6} dir="ltr" className="font-mono text-xs" value={text} onChange={(e) => setText(e.target.value)} placeholder={t("bulkPlaceholder")} data-testid="bulk-text" />
                <p className="text-xs text-muted-foreground">{t("bulkHint")}</p>
              </div>
              {rows.length > 0 && <p className="text-sm">{t("bulkRows", { count: rows.length })}</p>}
              <DialogFooter>
                <Button variant="outline" onClick={() => setOpen(false)}>
                  {t("cancel")}
                </Button>
                <Button onClick={submit} disabled={pending || rows.length === 0 || rows.length > 500} data-testid="bulk-send">
                  {pending && <Loader2 className="size-4 animate-spin" />}
                  {t("sendInvites", { count: rows.length })}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

export function InviteFamiliesButton({ waiting }: { waiting: number }) {
  const t = useTranslations("adminInvites");
  const err = useInviteError();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const submit = () =>
    start(async () => {
      const res = await inviteAllFamiliesAction();
      if (!res.ok) return void toast.error(err(res.error));
      toast.success(t("familiesInvited", { count: res.count }));
      setOpen(false);
      router.refresh();
    });
  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)} disabled={waiting === 0} data-testid="invite-families">
        <Users className="size-4" />
        {t("inviteFamilies")}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("inviteFamiliesTitle")}</DialogTitle>
            <DialogDescription>{t("inviteFamiliesBody", { count: waiting })}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              {t("cancel")}
            </Button>
            <Button onClick={submit} disabled={pending} data-testid="invite-families-confirm">
              {pending && <Loader2 className="size-4 animate-spin" />}
              {t("sendInvites", { count: waiting })}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ---------------------------------------------------------------------------
// Row actions
// ---------------------------------------------------------------------------

export function InviteRowActions({ id, canResend, canRevoke }: { id: string; canResend: boolean; canRevoke: boolean }) {
  const t = useTranslations("adminInvites");
  const err = useInviteError();
  const router = useRouter();
  const url = useJoinUrl();
  const [pending, start] = useTransition();
  const [link, setLink] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const resend = () =>
    start(async () => {
      const res = await resendInvitationAction(id);
      if (!res.ok) return void toast.error(err(res.error));
      setLink(url(res.token));
      router.refresh();
    });
  const revoke = () =>
    start(async () => {
      const res = await revokeInvitationAction(id);
      if (!res.ok) return void toast.error(err(res.error));
      toast.success(t("revoked"));
      setConfirm(false);
      router.refresh();
    });
  return (
    <div className="flex flex-wrap items-center gap-1 lg:justify-end">
      {canResend && (
        <Button variant="ghost" size="sm" onClick={resend} disabled={pending} data-testid="invite-resend">
          <RefreshCw className="size-4" />
          {t("resend")}
        </Button>
      )}
      {canRevoke && (
        <Button variant="ghost" size="sm" className="text-danger hover:text-danger" onClick={() => setConfirm(true)} disabled={pending} data-testid="invite-revoke">
          <Trash2 className="size-4" />
          {t("revoke")}
        </Button>
      )}
      <Dialog open={!!link} onOpenChange={(o) => !o && setLink(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("resentTitle")}</DialogTitle>
            <DialogDescription>{t("resentBody")}</DialogDescription>
          </DialogHeader>
          {link && <CopyField value={link} testId="resent-link" />}
          <DialogFooter>
            <Button onClick={() => setLink(null)}>{t("done")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={confirm} onOpenChange={setConfirm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("revokeTitle")}</DialogTitle>
            <DialogDescription>{t("revokeBody")}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirm(false)}>
              {t("cancel")}
            </Button>
            <Button variant="destructive" onClick={revoke} disabled={pending} data-testid="invite-revoke-confirm">
              {t("revoke")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Links and the family code
// ---------------------------------------------------------------------------

export function StaffLinkDialog({ roles }: { roles: RoleChoice[] }) {
  const t = useTranslations("adminInvites");
  const err = useInviteError();
  const router = useRouter();
  const url = useJoinUrl();
  const [open, setOpen] = useState(false);
  const [roleKey, setRoleKey] = useState("teacher");
  const [maxUses, setMaxUses] = useState("25");
  const [days, setDays] = useState("14");
  const [link, setLink] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const uses = Number(maxUses);
  const d = Number(days);
  const valid = Number.isInteger(uses) && uses >= 1 && uses <= 500 && Number.isInteger(d) && d >= 1 && d <= 90 && !!roleKey;
  const submit = () =>
    start(async () => {
      const res = await createStaffLinkAction({ roleKey, maxUses: uses, days: d });
      if (!res.ok) return void toast.error(err(res.error));
      setLink(url(res.token));
      router.refresh();
    });
  return (
    <>
      <Button variant="outline" onClick={() => { setLink(null); setOpen(true); }} data-testid="create-staff-link">
        <Link2 className="size-4" />
        {t("createLink")}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{link ? t("linkReadyTitle") : t("createLinkTitle")}</DialogTitle>
            <DialogDescription>{link ? t("linkReadyBody") : t("createLinkBody")}</DialogDescription>
          </DialogHeader>
          {link ? (
            <div className="space-y-3">
              <div className="flex justify-center">
                <QrCode value={link} label={t("qrLabel")} />
              </div>
              <CopyField value={link} testId="staff-link" />
              <DialogFooter>
                <Button onClick={() => setOpen(false)}>{t("done")}</Button>
              </DialogFooter>
            </div>
          ) : (
            <>
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label>{t("fieldRole")}</Label>
                  <Select value={roleKey} onValueChange={setRoleKey}>
                    <SelectTrigger className="w-full" data-testid="link-role">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {roles.map((r) => (
                        <SelectItem key={r.key} value={r.key}>
                          {r.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="link-uses">{t("fieldMaxUses")}</Label>
                    <Input id="link-uses" inputMode="numeric" dir="ltr" value={maxUses} onChange={(e) => setMaxUses(e.target.value.replace(/\D/g, ""))} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="link-days">{t("fieldDays")}</Label>
                    <Input id="link-days" inputMode="numeric" dir="ltr" value={days} onChange={(e) => setDays(e.target.value.replace(/\D/g, ""))} />
                  </div>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setOpen(false)}>
                  {t("cancel")}
                </Button>
                <Button onClick={submit} disabled={pending || !valid} data-testid="create-staff-link-save">
                  {pending && <Loader2 className="size-4 animate-spin" />}
                  {t("createLink")}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

export function RegenerateCodeButton() {
  const t = useTranslations("adminInvites");
  const err = useInviteError();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const submit = () =>
    start(async () => {
      const res = await regenerateJoinCodeAction();
      if (!res.ok) return void toast.error(err(res.error));
      toast.success(t("codeRegenerated"));
      setOpen(false);
      router.refresh();
    });
  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)} data-testid="regenerate-code">
        <RefreshCw className="size-4" />
        {t("regenerate")}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("regenerateTitle")}</DialogTitle>
            <DialogDescription>{t("regenerateBody")}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              {t("cancel")}
            </Button>
            <Button onClick={submit} disabled={pending} data-testid="regenerate-confirm">
              {pending && <Loader2 className="size-4 animate-spin" />}
              {t("regenerate")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function useFamilyUrl(code: string) {
  const [value, setValue] = useState(`/join?code=${encodeURIComponent(code)}`);
  useEffect(() => setValue(`${window.location.origin}/join?code=${encodeURIComponent(code)}`), [code]);
  return value;
}

/** QR for the family join page, built in the browser so it uses the address people actually see. */
export function FamilyQr({ code }: { code: string }) {
  const t = useTranslations("adminInvites");
  const value = useFamilyUrl(code);
  if (!value.startsWith("http")) return <div className="size-[168px] rounded-lg border bg-muted/40" />;
  return <QrCode value={value} label={t("qrLabel")} />;
}

export function FamilyJoinUrl({ code }: { code: string }) {
  return <CopyField value={useFamilyUrl(code)} testId="family-join-url" />;
}
