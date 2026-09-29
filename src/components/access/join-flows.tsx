"use client";

import { useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { ArrowLeft, ArrowRight, Briefcase, GraduationCap, Loader2, LogOut, Plus, Trash2, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { acceptInviteAction, checkJoinCodeAction, continueWithProviderAction, joinWithCodeAction, signOutToJoinAction } from "@/server/access/join-actions";
import { SchoolBadge } from "./join-frame";

type Mode = "create" | "signin";
type Providers = { google: boolean; microsoft: boolean };
type SessionUser = { name: string; email: string } | null;

function useJoinError() {
  const t = useTranslations("join");
  return (code?: string | null) => (code ? (t.has(`error.${code}`) ? t(`error.${code}`) : t("error.generic")) : null);
}

function ErrorBox({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger" data-testid="join-error">
      {message}
    </p>
  );
}

function Card({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("rounded-2xl border bg-card p-5 shadow-sm sm:p-6", className)}>{children}</div>;
}

// ---------------------------------------------------------------------------
// Account step
// ---------------------------------------------------------------------------

type AccountState = { mode: Mode; name: string; email: string; password: string };

function AccountFields({ value, onChange, lockedEmail }: { value: AccountState; onChange: (v: AccountState) => void; lockedEmail?: string | null }) {
  const t = useTranslations("join");
  const set = (patch: Partial<AccountState>) => onChange({ ...value, ...patch });
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 rounded-lg bg-muted p-1 text-sm">
        {(["create", "signin"] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => set({ mode: m })}
            className={cn("rounded-md px-3 py-2 font-medium transition", value.mode === m ? "bg-card shadow-xs" : "text-muted-foreground")}
            data-testid={`account-mode-${m}`}
          >
            {m === "create" ? t("createAccount") : t("haveAccount")}
          </button>
        ))}
      </div>
      {value.mode === "create" && (
        <div className="space-y-1.5">
          <Label htmlFor="join-name">{t("fullName")}</Label>
          <Input id="join-name" autoComplete="name" value={value.name} onChange={(e) => set({ name: e.target.value })} className="h-11" data-testid="join-name" />
        </div>
      )}
      <div className="space-y-1.5">
        <Label htmlFor="join-email">{t("email")}</Label>
        <Input
          id="join-email"
          type="email"
          dir="ltr"
          autoComplete="email"
          value={lockedEmail ?? value.email}
          readOnly={!!lockedEmail}
          onChange={(e) => set({ email: e.target.value })}
          className="h-11 text-start"
          data-testid="join-email"
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="join-password">{t("password")}</Label>
        <Input
          id="join-password"
          type="password"
          dir="ltr"
          autoComplete={value.mode === "create" ? "new-password" : "current-password"}
          value={value.password}
          onChange={(e) => set({ password: e.target.value })}
          className="h-11 text-start"
          data-testid="join-password"
        />
        {value.mode === "create" && <p className="text-xs text-muted-foreground">{t("passwordHint")}</p>}
      </div>
    </div>
  );
}

function accountValid(a: AccountState, lockedEmail?: string | null) {
  const email = (lockedEmail ?? a.email).trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return false;
  if (a.mode === "create") return a.name.trim().length >= 2 && a.password.length >= 8;
  return a.password.length > 0;
}

function ProviderButtons({ providers, returnPath }: { providers: Providers; returnPath: string }) {
  const t = useTranslations("join");
  const [pending, start] = useTransition();
  if (!providers.google && !providers.microsoft) return null;
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3 text-xs text-muted-foreground">
        <span className="h-px flex-1 bg-border" />
        {t("orContinue")}
        <span className="h-px flex-1 bg-border" />
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {providers.google && (
          <Button variant="outline" className="h-11" disabled={pending} onClick={() => start(async () => void (await continueWithProviderAction("google", returnPath)))}>
            {t("google")}
          </Button>
        )}
        {providers.microsoft && (
          <Button variant="outline" className="h-11" disabled={pending} onClick={() => start(async () => void (await continueWithProviderAction("microsoft-entra-id", returnPath)))}>
            {t("microsoft")}
          </Button>
        )}
      </div>
    </div>
  );
}

function SignedInAs({ user, returnPath }: { user: NonNullable<SessionUser>; returnPath: string }) {
  const t = useTranslations("join");
  const [pending, start] = useTransition();
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-muted/40 px-3 py-2.5 text-sm">
      <div className="min-w-0">
        <div className="text-xs text-muted-foreground">{t("signedInAs")}</div>
        <div className="truncate font-medium">{user.name}</div>
        <div className="truncate text-xs text-muted-foreground" dir="ltr">
          {user.email}
        </div>
      </div>
      <Button variant="ghost" size="sm" disabled={pending} onClick={() => start(() => signOutToJoinAction(returnPath))}>
        <LogOut className="size-4" />
        {t("differentAccount")}
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Personal invitation or staff link
// ---------------------------------------------------------------------------

export function InviteJoin({
  token,
  school,
  headline,
  detail,
  email,
  session,
  providers,
}: {
  token: string;
  school: { name: string; logoUrl: string | null; color: string };
  headline: string;
  detail: string;
  email: string | null;
  session: SessionUser;
  providers: Providers;
}) {
  const t = useTranslations("join");
  const locale = useLocale();
  const err = useJoinError();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [account, setAccount] = useState<AccountState>({ mode: "create", name: "", email: email ?? "", password: "" });
  const returnPath = `/${locale}/join/${token}`;
  const wrongUser = !!(session && email && session.email.toLowerCase() !== email.toLowerCase());

  const submit = () =>
    start(async () => {
      setError(null);
      const res = await acceptInviteAction({ token, locale, account: session && !wrongUser ? { mode: "session" } : { ...account, email: email ?? account.email } });
      if (res && !res.ok) setError(err(res.error));
    });

  return (
    <Card className="space-y-5">
      <SchoolBadge name={school.name} logoUrl={school.logoUrl} color={school.color} />
      <div>
        <h1 className="text-xl font-semibold tracking-tight" data-testid="join-headline">
          {headline}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">{detail}</p>
      </div>
      {session && !wrongUser ? (
        <SignedInAs user={session} returnPath={returnPath} />
      ) : (
        <>
          {wrongUser && session && (
            <>
              <SignedInAs user={session} returnPath={returnPath} />
              <p className="text-sm text-muted-foreground">{t("inviteForOtherEmail")}</p>
            </>
          )}
          <AccountFields value={account} onChange={setAccount} lockedEmail={email} />
        </>
      )}
      <ErrorBox message={error} />
      <Button className="h-11 w-full" onClick={submit} disabled={pending || (!(session && !wrongUser) && !accountValid(account, email))} data-testid="join-accept">
        {pending && <Loader2 className="size-4 animate-spin" />}
        {t("acceptAndJoin")}
      </Button>
      {!session && <ProviderButtons providers={providers} returnPath={returnPath} />}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// School code
// ---------------------------------------------------------------------------

type ChildForm = { method: "number" | "name"; studentNo: string; dateOfBirth: string; grade: string; fullName: string };
const emptyChild = (): ChildForm => ({ method: "number", studentNo: "", dateOfBirth: "", grade: "", fullName: "" });
type CodeInfo = { school: { nameEn: string; nameAr: string; logoUrl: string | null; primaryColor: string; approval: boolean }; options: { parent: boolean; student: boolean; staff: boolean; staffDomains: string[] } };
type Kind = "PARENT" | "STUDENT" | "STAFF";

function childValid(c: ChildForm, kind: Kind) {
  if (kind === "STUDENT" || c.method === "number") return c.studentNo.trim().length > 0 && /^\d{4}-\d{2}-\d{2}$/.test(c.dateOfBirth);
  return c.grade !== "" && c.fullName.trim().split(/\s+/).length >= 2;
}

function ChildFields({ index, value, onChange, onRemove, kind }: { index: number; value: ChildForm; onChange: (v: ChildForm) => void; onRemove?: () => void; kind: Kind }) {
  const t = useTranslations("join");
  const set = (patch: Partial<ChildForm>) => onChange({ ...value, ...patch });
  const byNumber = kind === "STUDENT" || value.method === "number";
  return (
    <div className="space-y-3 rounded-xl border p-4" data-testid="child-form">
      <div className="flex items-center justify-between gap-2">
        <div className="text-sm font-semibold">{kind === "STUDENT" ? t("yourDetails") : t("childN", { n: index + 1 })}</div>
        {onRemove && (
          <Button variant="ghost" size="sm" onClick={onRemove} aria-label={t("removeChild")}>
            <Trash2 className="size-4" />
          </Button>
        )}
      </div>
      {kind === "PARENT" && (
        <div className="grid grid-cols-2 rounded-lg bg-muted p-1 text-xs">
          {(["number", "name"] as const).map((m) => (
            <button key={m} type="button" onClick={() => set({ method: m })} className={cn("rounded-md px-2 py-1.5 font-medium", value.method === m ? "bg-card shadow-xs" : "text-muted-foreground")} data-testid={`child-method-${m}`}>
              {m === "number" ? t("byNumber") : t("byName")}
            </button>
          ))}
        </div>
      )}
      {byNumber ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor={`sn-${index}`}>{t("studentNumber")}</Label>
            <Input id={`sn-${index}`} dir="ltr" className="h-11 text-start" value={value.studentNo} onChange={(e) => set({ studentNo: e.target.value })} data-testid="child-number" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`dob-${index}`}>{t("dateOfBirth")}</Label>
            <Input id={`dob-${index}`} type="date" dir="ltr" className="h-11 text-start" value={value.dateOfBirth} onChange={(e) => set({ dateOfBirth: e.target.value })} data-testid="child-dob" />
          </div>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-[120px_minmax(0,1fr)]">
          <div className="space-y-1.5">
            <Label>{t("grade")}</Label>
            <Select value={value.grade} onValueChange={(v) => set({ grade: v })}>
              <SelectTrigger className="h-11 w-full" data-testid="child-grade">
                <SelectValue placeholder={t("choose")} />
              </SelectTrigger>
              <SelectContent>
                {Array.from({ length: 13 }, (_, i) => i + 1).map((g) => (
                  <SelectItem key={g} value={String(g)}>
                    {t("gradeN", { grade: g })}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`fn-${index}`}>{t("childFullName")}</Label>
            <Input id={`fn-${index}`} className="h-11" value={value.fullName} onChange={(e) => set({ fullName: e.target.value })} data-testid="child-fullname" />
          </div>
        </div>
      )}
    </div>
  );
}

export function CodeJoin({ initialCode, session, providers }: { initialCode: string; session: SessionUser; providers: Providers }) {
  const t = useTranslations("join");
  const locale = useLocale();
  const err = useJoinError();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<"code" | "who" | "details" | "account">("code");
  const [code, setCode] = useState(initialCode);
  const [info, setInfo] = useState<CodeInfo | null>(null);
  const [kind, setKind] = useState<Kind>("PARENT");
  const [children, setChildren] = useState<ChildForm[]>([emptyChild()]);
  const [note, setNote] = useState("");
  const [account, setAccount] = useState<AccountState>({ mode: "create", name: "", email: "", password: "" });
  const schoolName = info ? (locale === "ar" ? info.school.nameAr : info.school.nameEn) : "";
  const returnPath = `/${locale}/join${code ? `?code=${encodeURIComponent(code.trim())}` : ""}`;

  const check = () =>
    start(async () => {
      setError(null);
      const res = await checkJoinCodeAction(code);
      if (!res.ok) return void setError(err(res.error));
      setInfo(res);
      const kinds: Kind[] = [...(res.options.parent ? (["PARENT"] as const) : []), ...(res.options.student ? (["STUDENT"] as const) : []), ...(res.options.staff ? (["STAFF"] as const) : [])];
      if (kinds.length === 0) return void setError(err("CLOSED"));
      setKind(kinds[0]);
      setStep(kinds.length === 1 ? "details" : "who");
    });

  const submit = () =>
    start(async () => {
      setError(null);
      const claims = kind === "STAFF" ? [] : children.map((c) => (kind === "STUDENT" || c.method === "number" ? { studentNo: c.studentNo, dateOfBirth: c.dateOfBirth } : { grade: Number(c.grade), fullName: c.fullName }));
      const res = await joinWithCodeAction({ code, kind, locale, account: session ? { mode: "session" } : account, children: claims, note });
      if (res && !res.ok) setError(err(res.error));
    });

  const detailsValid = kind === "STAFF" ? true : children.length > 0 && children.every((c) => childValid(c, kind));
  const steps = ["code", "details", "account"] as const;
  const progress = step === "code" ? 0 : step === "account" ? 2 : 1;

  return (
    <Card className="space-y-5">
      <div className="flex gap-1.5" aria-hidden>
        {steps.map((s, i) => (
          <span key={s} className={cn("h-1.5 flex-1 rounded-full", i <= progress ? "bg-brand" : "bg-muted")} />
        ))}
      </div>
      {info && <SchoolBadge name={schoolName} logoUrl={info.school.logoUrl} color={info.school.primaryColor} />}

      {step === "code" && (
        <div className="space-y-4">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">{t("codeTitle")}</h1>
            <p className="mt-1 text-sm text-muted-foreground">{t("codeBody")}</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="join-code">{t("schoolCode")}</Label>
            <Input id="join-code" dir="ltr" autoCapitalize="characters" autoComplete="off" className="h-12 text-center font-mono text-lg tracking-widest uppercase" value={code} onChange={(e) => setCode(e.target.value)} onKeyDown={(e) => e.key === "Enter" && code.trim() && check()} data-testid="join-code-input" />
          </div>
          <ErrorBox message={error} />
          <Button className="h-11 w-full" onClick={check} disabled={pending || code.trim().length < 4} data-testid="join-code-next">
            {pending && <Loader2 className="size-4 animate-spin" />}
            {t("continue")}
          </Button>
        </div>
      )}

      {step === "who" && info && (
        <div className="space-y-3">
          <h1 className="text-xl font-semibold tracking-tight">{t("whoTitle")}</h1>
          {([
            ["PARENT", info.options.parent, Users],
            ["STUDENT", info.options.student, GraduationCap],
            ["STAFF", info.options.staff, Briefcase],
          ] as const)
            .filter(([, on]) => on)
            .map(([k, , Icon]) => (
              <button
                key={k}
                type="button"
                onClick={() => {
                  setKind(k);
                  setStep("details");
                }}
                className="flex w-full items-center gap-3 rounded-xl border p-4 text-start transition hover:border-brand/50 hover:bg-brand-soft/30"
                data-testid={`who-${k}`}
              >
                <span className="grid size-10 place-items-center rounded-lg bg-brand-soft text-brand">
                  <Icon className="size-5" />
                </span>
                <span>
                  <span className="block text-sm font-semibold">{t(`who.${k}`)}</span>
                  <span className="block text-xs text-muted-foreground">{k === "STAFF" ? t("whoStaffBody", { domains: info.options.staffDomains.map((d) => `@${d}`).join(", ") }) : t(`whoBody.${k}`)}</span>
                </span>
              </button>
            ))}
        </div>
      )}

      {step === "details" && info && (
        <div className="space-y-4">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">{t(`detailsTitle.${kind}`)}</h1>
            <p className="mt-1 text-sm text-muted-foreground">{kind === "STAFF" ? t("staffDetailsBody", { domains: info.options.staffDomains.map((d) => `@${d}`).join(", ") }) : t(`detailsBody.${kind}`)}</p>
          </div>
          {kind === "STAFF" ? (
            <div className="space-y-1.5">
              <Label htmlFor="join-note">{t("staffNote")}</Label>
              <Textarea id="join-note" rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("staffNotePlaceholder")} />
            </div>
          ) : (
            <>
              {(kind === "STUDENT" ? children.slice(0, 1) : children).map((c, i) => (
                <ChildFields key={i} index={i} value={c} kind={kind} onChange={(v) => setChildren((cur) => cur.map((x, j) => (j === i ? v : x)))} onRemove={kind === "PARENT" && children.length > 1 ? () => setChildren((cur) => cur.filter((_, j) => j !== i)) : undefined} />
              ))}
              {kind === "PARENT" && children.length < 8 && (
                <Button variant="outline" className="w-full" onClick={() => setChildren((c) => [...c, emptyChild()])} data-testid="add-child">
                  <Plus className="size-4" />
                  {t("addAnotherChild")}
                </Button>
              )}
            </>
          )}
          <div className="flex gap-2">
            <Button variant="ghost" className="h-11" onClick={() => setStep(info.options.parent && (info.options.student || info.options.staff) ? "who" : "code")}>
              <ArrowLeft className="size-4 rtl:rotate-180" />
              {t("back")}
            </Button>
            <Button className="h-11 flex-1" onClick={() => setStep("account")} disabled={!detailsValid} data-testid="details-next">
              {t("continue")}
              <ArrowRight className="size-4 rtl:rotate-180" />
            </Button>
          </div>
        </div>
      )}

      {step === "account" && info && (
        <div className="space-y-4">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">{session ? t("confirmTitle") : t("accountTitle")}</h1>
            <p className="mt-1 text-sm text-muted-foreground">{kind === "STAFF" ? t("accountBodyStaff") : info.school.approval ? t("accountBodyApproval") : t("accountBodyInstant")}</p>
          </div>
          {session ? <SignedInAs user={session} returnPath={returnPath} /> : <AccountFields value={account} onChange={setAccount} />}
          <ErrorBox message={error} />
          <div className="flex gap-2">
            <Button variant="ghost" className="h-11" onClick={() => setStep("details")}>
              <ArrowLeft className="size-4 rtl:rotate-180" />
              {t("back")}
            </Button>
            <Button className="h-11 flex-1" onClick={submit} disabled={pending || (!session && !accountValid(account))} data-testid="join-submit">
              {pending && <Loader2 className="size-4 animate-spin" />}
              {t("joinSchool")}
            </Button>
          </div>
          {!session && <ProviderButtons providers={providers} returnPath={returnPath} />}
        </div>
      )}
    </Card>
  );
}
