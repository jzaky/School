"use client";

// Adding or editing a roster connection: the source (ClassLink Roster Server, Clever or another OneRoster
// server), its address and credentials (write-only), which of the feed's schools to import, what to import,
// grade codes and staff roles, the removal limit and the schedule.
import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Loader2, Pencil, PlugZap, Plus, Trash2 } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { GRADE_CODES, STAFF_FEED_ROLES, type RosterOptions } from "@/lib/rostering/options";
import { ALL_GRADE_LEVELS, gradeLevelValues } from "@/lib/grade-levels";
import { deleteConnectionAction, saveConnectionAction, testConnectionAction, type ConnectionInput } from "@/server/rostering/actions";
import { MethodMark } from "@/components/sso/brand";

export type ConnectionValue = {
  id?: string;
  provider: "classlink" | "clever" | "oneroster";
  name: string;
  baseUrl: string;
  authMode: "OAUTH1" | "OAUTH2" | "BEARER";
  tokenUrl: string;
  hasCredentials: boolean;
  schoolIds: string[];
  schedule: "OFF" | "DAILY" | "HOURLY";
  hour: number;
  enabled: boolean;
  options: RosterOptions;
};

type RoleOption = { key: string; label: string };

function useError() {
  const t = useTranslations("roster");
  return (code: string) => (t.has(`errors.${code}`) ? t(`errors.${code}`) : t("errors.generic"));
}

export function ConnectionDialogButton({ initial, roles, disabledReason, variant = "new" }: { initial: ConnectionValue; roles: RoleOption[]; disabledReason?: string | null; variant?: "new" | "edit" }) {
  const t = useTranslations("roster");
  const [open, setOpen] = useState(false);
  const trigger =
    variant === "new" ? (
      <Button onClick={() => setOpen(true)} disabled={!!disabledReason} data-testid="add-connection">
        <Plus className="size-4" />
        {t("addConnection")}
      </Button>
    ) : (
      <Button variant="outline" size="sm" onClick={() => setOpen(true)} data-testid="edit-connection">
        <Pencil className="size-4" />
        {t("edit")}
      </Button>
    );
  return (
    <>
      {disabledReason ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <span tabIndex={0}>{trigger}</span>
          </TooltipTrigger>
          <TooltipContent>{disabledReason}</TooltipContent>
        </Tooltip>
      ) : (
        trigger
      )}
      {open && <ConnectionDialog initial={initial} roles={roles} onClose={() => setOpen(false)} />}
    </>
  );
}

function ConnectionDialog({ initial, roles, onClose }: { initial: ConnectionValue; roles: RoleOption[]; onClose: () => void }) {
  const t = useTranslations("roster");
  const tg = useTranslations("gradeLevel");
  const errorText = useError();
  const router = useRouter();
  const [v, setV] = useState<ConnectionValue>(initial);
  const [key, setKey] = useState("");
  const [secret, setSecret] = useState("");
  const [token, setToken] = useState("");
  const [schools, setSchools] = useState(initial.schoolIds.join(", "));
  const [found, setFound] = useState<Array<{ id: string; name: string }> | null>(null);
  const [pending, start] = useTransition();
  const [testing, startTest] = useTransition();
  const set = (patch: Partial<ConnectionValue>) => setV((c) => ({ ...c, ...patch }));
  const setOpt = (patch: Partial<RosterOptions>) => setV((c) => ({ ...c, options: { ...c.options, ...patch } }));
  const clever = v.provider === "clever";
  const editing = !!v.id;
  const chosen = schools.split(/[,\s]+/).map((x) => x.trim()).filter(Boolean);

  const input = (): ConnectionInput => ({
    id: v.id,
    provider: v.provider,
    name: v.name,
    baseUrl: v.baseUrl,
    authMode: clever ? "BEARER" : v.authMode,
    tokenUrl: v.tokenUrl,
    key,
    secret,
    token,
    schoolIds: chosen,
    schedule: v.schedule,
    hour: v.hour,
    enabled: v.enabled,
    options: v.options,
  });

  const save = () =>
    start(async () => {
      const res = await saveConnectionAction(input());
      if (!res.ok) return void toast.error(errorText(res.error));
      toast.success(t("saved"));
      router.refresh();
      onClose();
    });

  const test = () =>
    startTest(async () => {
      const saved = await saveConnectionAction(input());
      if (!saved.ok) return void toast.error(errorText(saved.error));
      set({ id: saved.id, hasCredentials: true });
      const res = await testConnectionAction(saved.id);
      if (!res.ok) return void toast.error(errorText(res.error));
      setFound(res.schools);
      toast.success(t("testOk", { count: res.schools.length }));
      router.refresh();
    });

  const levelLabel = (l: number) => tg("label", gradeLevelValues(l));

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{editing ? t("editTitle") : t("newTitle")}</DialogTitle>
          <DialogDescription>{t("dialogBody")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-5">
          {!editing && (
            <div className="grid gap-2 sm:grid-cols-3">
              {(["classlink", "clever", "oneroster"] as const).map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => set({ provider: p, authMode: p === "clever" ? "BEARER" : "OAUTH1", name: v.name || t(`providers.${p}`) })}
                  className={`flex items-center gap-2 rounded-lg border p-3 text-start text-sm transition ${v.provider === p ? "border-brand bg-brand-soft/40 ring-1 ring-brand/30" : "hover:border-brand/40"}`}
                  data-testid={`provider-${p}`}
                >
                  {p === "oneroster" ? <PlugZap className="size-5 text-brand" /> : <MethodMark method={p} className="size-5" />}
                  <span className="font-medium">{t(`providers.${p}`)}</span>
                </button>
              ))}
            </div>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="rc-name">{t("name")}</Label>
              <Input id="rc-name" value={v.name} onChange={(e) => set({ name: e.target.value })} data-testid="connection-name" />
            </div>
            {!clever && (
              <div className="space-y-1.5">
                <Label>{t("authMode")}</Label>
                <Select value={v.authMode} onValueChange={(x) => set({ authMode: x as ConnectionValue["authMode"] })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(["OAUTH1", "OAUTH2", "BEARER"] as const).map((m) => (
                      <SelectItem key={m} value={m}>
                        {t(`authModes.${m}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rc-url">{clever ? t("cleverApi") : t("baseUrl")}</Label>
            <Input id="rc-url" dir="ltr" className="text-start" value={v.baseUrl} onChange={(e) => set({ baseUrl: e.target.value })} placeholder={clever ? "https://api.clever.com" : t("baseUrlPlaceholder")} data-testid="connection-url" />
            <p className="text-xs text-muted-foreground">{v.baseUrl.startsWith("demo://") ? t("demoFeedHelp") : clever ? t("cleverApiHelp") : t(`baseUrlHelp.${v.provider}`)}</p>
          </div>
          {!clever && v.authMode === "OAUTH2" && (
            <div className="space-y-1.5">
              <Label htmlFor="rc-token-url">{t("tokenUrl")}</Label>
              <Input id="rc-token-url" dir="ltr" className="text-start" value={v.tokenUrl} onChange={(e) => set({ tokenUrl: e.target.value })} />
            </div>
          )}
          {clever || v.authMode === "BEARER" ? (
            <div className="space-y-1.5">
              <Label htmlFor="rc-token">{clever ? t("districtToken") : t("token")}</Label>
              <Input id="rc-token" type="password" dir="ltr" className="text-start" autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)} placeholder={v.hasCredentials ? t("savedSecret") : ""} />
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="rc-key">{t("clientId")}</Label>
                <Input id="rc-key" dir="ltr" className="text-start" autoComplete="off" value={key} onChange={(e) => setKey(e.target.value)} placeholder={v.hasCredentials ? t("savedSecret") : ""} data-testid="connection-key" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="rc-secret">{t("clientSecret")}</Label>
                <Input id="rc-secret" type="password" dir="ltr" className="text-start" autoComplete="off" value={secret} onChange={(e) => setSecret(e.target.value)} placeholder={v.hasCredentials ? t("savedSecret") : ""} data-testid="connection-secret" />
              </div>
            </div>
          )}
          <p className="text-xs text-muted-foreground">{t("credentialsNote")}</p>

          <div className="space-y-2 rounded-lg border p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Label htmlFor="rc-schools" className="text-sm font-medium">
                {t("schools")}
              </Label>
              <Button type="button" variant="outline" size="sm" onClick={test} disabled={testing || pending} data-testid="test-connection">
                {testing ? <Loader2 className="size-4 animate-spin" /> : <PlugZap className="size-4" />}
                {t("test")}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">{t("schoolsHelp")}</p>
            {found && found.length > 0 ? (
              <ul className="space-y-1.5" data-testid="found-schools">
                {found.map((s) => (
                  <li key={s.id} className="flex items-center gap-2 text-sm">
                    <Checkbox
                      id={`school-${s.id}`}
                      checked={chosen.includes(s.id)}
                      onCheckedChange={(c) => setSchools((c ? [...chosen, s.id] : chosen.filter((x) => x !== s.id)).join(", "))}
                    />
                    <Label htmlFor={`school-${s.id}`} className="font-normal">
                      {s.name} <span className="font-mono text-xs text-muted-foreground" dir="ltr">{s.id}</span>
                    </Label>
                  </li>
                ))}
              </ul>
            ) : (
              <Input id="rc-schools" dir="ltr" className="text-start" value={schools} onChange={(e) => setSchools(e.target.value)} placeholder={t("schoolsPlaceholder")} />
            )}
          </div>

          <div className="space-y-2">
            <h3 className="text-sm font-semibold">{t("importTitle")}</h3>
            <div className="grid gap-2 sm:grid-cols-2">
              {(["importStaff", "importStudents", "importGuardians", "importClasses", "importDemographics"] as const).map((k) => (
                <label key={k} className="flex items-start gap-2 rounded-lg border p-2.5 text-sm">
                  <Switch checked={v.options[k]} onCheckedChange={(c) => setOpt({ [k]: c } as Partial<RosterOptions>)} />
                  <span>
                    <span className="block font-medium">{t(`imports.${k}`)}</span>
                    <span className="block text-xs text-muted-foreground">{t(`imports.${k}Help`)}</span>
                  </span>
                </label>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <h3 className="text-sm font-semibold">{t("gradesTitle")}</h3>
            <p className="text-xs text-muted-foreground">{t("gradesHelp")}</p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3" data-testid="grade-map">
              {GRADE_CODES.map((code) => {
                const level = v.options.gradeMap[code];
                return (
                  <div key={code} className="flex items-center gap-2">
                    <span className="w-12 shrink-0 font-mono text-xs" dir="ltr">
                      {code}
                    </span>
                    <Select value={typeof level === "number" ? String(level) : "none"} onValueChange={(x) => setOpt({ gradeMap: { ...v.options.gradeMap, [code]: x === "none" ? null : Number(x) } })}>
                      <SelectTrigger className="h-8 min-w-0 flex-1 text-xs" aria-label={code}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">{t("notImported")}</SelectItem>
                        {ALL_GRADE_LEVELS.map((l) => (
                          <SelectItem key={l} value={String(l)}>
                            {levelLabel(l)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="space-y-2">
            <h3 className="text-sm font-semibold">{t("rolesTitle")}</h3>
            <p className="text-xs text-muted-foreground">{t("rolesHelp")}</p>
            <div className="grid gap-2 sm:grid-cols-2">
              {STAFF_FEED_ROLES.map((r) => (
                <div key={r} className="flex items-center gap-2">
                  <span className="w-28 shrink-0 text-sm">{t(`feedRoles.${r}`)}</span>
                  <Select value={v.options.roleMap[r] ?? "none"} onValueChange={(x) => setOpt({ roleMap: { ...v.options.roleMap, [r]: x === "none" ? null : x } })}>
                    <SelectTrigger className="h-8 min-w-0 flex-1 text-xs" aria-label={t(`feedRoles.${r}`)}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">{t("notImported")}</SelectItem>
                      {roles.map((role) => (
                        <SelectItem key={role.key} value={role.key}>
                          {role.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ))}
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label>{t("schedule")}</Label>
              <Select value={v.schedule} onValueChange={(x) => set({ schedule: x as ConnectionValue["schedule"] })}>
                <SelectTrigger data-testid="connection-schedule">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(["OFF", "DAILY", "HOURLY"] as const).map((s) => (
                    <SelectItem key={s} value={s}>
                      {t(`schedules.${s}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {v.schedule !== "OFF" && (
              <div className="space-y-1.5">
                <Label>{v.schedule === "DAILY" ? t("hour") : t("fullHour")}</Label>
                <Select value={String(v.hour)} onValueChange={(x) => set({ hour: Number(x) })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Array.from({ length: 24 }, (_, h) => (
                      <SelectItem key={h} value={String(h)}>
                        <span dir="ltr">{`${String(h).padStart(2, "0")}:00`}</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="rc-limit">{t("removalLimit")}</Label>
              <Input id="rc-limit" type="number" min={1} max={100} dir="ltr" className="text-start" value={v.options.removalLimitPercent} onChange={(e) => setOpt({ removalLimitPercent: Math.max(1, Math.min(100, Number(e.target.value) || 10)) })} />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">{t("removalLimitHelp")}</p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t("cancel")}
          </Button>
          <Button onClick={save} disabled={pending || testing || !v.name.trim()} data-testid="save-connection">
            {pending && <Loader2 className="size-4 animate-spin" />}
            {t("save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function DeleteConnectionButton({ id, name }: { id: string; name: string }) {
  const t = useTranslations("roster");
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      variant="ghost"
      size="sm"
      className="text-danger hover:text-danger"
      disabled={pending}
      onClick={() =>
        start(async () => {
          if (!window.confirm(t("deleteConfirm", { name }))) return;
          const res = await deleteConnectionAction(id);
          if (!res.ok) return void toast.error(t("errors.generic"));
          toast.success(t("deleted"));
          router.refresh();
        })
      }
      data-testid="delete-connection"
    >
      {pending ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
      {t("delete")}
    </Button>
  );
}
