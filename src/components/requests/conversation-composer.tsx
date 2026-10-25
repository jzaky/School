"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Check, EyeOff, Info, Loader2, Lock, Send, Users } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { postRequestMessageAction } from "@/server/requests/conversation-actions";

type Vis = "SHARED" | "STAFF" | "PRIVATE";
type TeamMember = { id: string; name: string; title: string };

const TONE: Record<Vis, { on: string; hint: string }> = {
  SHARED: { on: "border-info bg-info-soft text-info", hint: "border-info/25 bg-info-soft/50" },
  STAFF: { on: "border-warning bg-warning-soft text-[oklch(0.5_0.13_65)]", hint: "border-warning/30 bg-warning-soft/50" },
  PRIVATE: { on: "border-violet-400 bg-violet-50 text-violet-700", hint: "border-violet-200 bg-violet-50/70" },
};
const ICON: Record<Vis, React.ComponentType<{ className?: string }>> = { SHARED: Users, STAFF: EyeOff, PRIVATE: Lock };

export function ConversationComposer(props: {
  requestId: string;
  staff: boolean;
  requesterSide: boolean;
  audience: "family" | "requester";
  sensitive: boolean;
  sharedBlocked: boolean;
  familyNames: string[];
  team: TeamMember[];
  teamCount: number;
}) {
  const { requestId, staff, requesterSide, audience, sensitive, sharedBlocked, familyNames, team, teamCount } = props;
  const t = useTranslations("conversation");
  const router = useRouter();
  const options: Vis[] = !staff ? ["SHARED"] : requesterSide ? ["SHARED", "PRIVATE"] : ["SHARED", "STAFF", "PRIVATE"];
  const [vis, setVis] = useState<Vis>(staff && sharedBlocked ? "STAFF" : "SHARED");
  const [body, setBody] = useState("");
  const [to, setTo] = useState<string[]>([]);
  const [notifyFamily, setNotifyFamily] = useState(false);
  const [reason, setReason] = useState("");
  const [pending, start] = useTransition();

  const sharedLabel = audience === "family" ? t("vis.SHARED") : t("vis.SHARED_REQUESTER");
  const label = (v: Vis) => (v === "SHARED" ? sharedLabel : t(`vis.${v}`));
  const decision = staff && !requesterSide && sensitive && vis === "SHARED";
  const valid = body.trim().length > 0 && (vis !== "PRIVATE" || to.length > 0) && (!decision || !notifyFamily || reason.trim().length >= 5);
  const join = (names: string[]) => names.join(t("listSeparator"));

  const hint = (() => {
    if (!staff) return t("hint.family");
    if (vis === "SHARED") {
      if (requesterSide) return t("hint.sharedRequester");
      const who = familyNames.length ? join(familyNames) : t("theRequester");
      if (sensitive) return t("hint.sharedSensitive", { family: who });
      return audience === "family" ? t("hint.shared", { family: who }) : t("hint.sharedStaffRequest", { family: who });
    }
    if (vis === "STAFF") return t("hint.staff", { n: teamCount });
    return to.length ? t("hint.privateTo", { names: join(team.filter((m) => to.includes(m.id)).map((m) => m.name)) }) : t("hint.privatePick");
  })();

  const send = () =>
    start(async () => {
      const r = await postRequestMessageAction({ requestId, body, visibility: vis, privateToIds: vis === "PRIVATE" ? to : undefined, notifyFamily: decision ? notifyFamily : undefined, notifyReason: decision && notifyFamily ? reason : undefined });
      if (!r.ok) return void toast.error(t.has(`error.${r.error}`) ? t(`error.${r.error}`) : t("error.generic"));
      toast.success(vis === "SHARED" ? t("sentShared") : vis === "STAFF" ? t("sentStaff") : t("sentPrivate"));
      setBody("");
      setTo([]);
      setNotifyFamily(false);
      setReason("");
      router.refresh();
    });

  const HintIcon = staff ? ICON[vis] : Users;
  return (
    <div className="space-y-3" data-testid="composer">
      {staff && (
        <div role="radiogroup" aria-label={t("visibilityLabel")} className="grid grid-cols-1 gap-1.5 sm:grid-cols-3" data-testid="visibility-switch">
          {options.map((v) => {
            const I = ICON[v];
            const blocked = v === "SHARED" && sharedBlocked;
            const btn = (
              <button
                key={v}
                type="button"
                role="radio"
                aria-checked={vis === v}
                disabled={blocked}
                onClick={() => setVis(v)}
                className={cn(
                  "flex w-full items-center gap-2 rounded-lg border bg-card px-3 py-2 text-start text-sm font-medium transition",
                  vis === v ? TONE[v].on : "text-muted-foreground hover:border-foreground/20 hover:text-foreground",
                  blocked && "cursor-not-allowed opacity-50",
                )}
                data-testid={`vis-${v}`}
              >
                <I className="size-4 shrink-0" />
                <span className="truncate">{label(v)}</span>
                {vis === v && <Check className="ms-auto size-3.5 shrink-0" />}
              </button>
            );
            return blocked ? (
              <Tooltip key={v}>
                <TooltipTrigger asChild>
                  <span tabIndex={0} className="block">
                    {btn}
                  </span>
                </TooltipTrigger>
                <TooltipContent className="max-w-xs">{t("sharedBlocked")}</TooltipContent>
              </Tooltip>
            ) : (
              btn
            );
          })}
        </div>
      )}

      <div className={cn("flex items-start gap-2 rounded-lg border px-3 py-2 text-xs", staff ? TONE[vis].hint : TONE.SHARED.hint)} data-testid="who-can-see">
        <HintIcon className="mt-0.5 size-3.5 shrink-0" />
        <p>
          <span className="font-semibold">{t("whoCanSee")} </span>
          {hint}
        </p>
      </div>

      {staff && vis === "PRIVATE" && (
        <div className="space-y-1.5" data-testid="private-picker">
          <div className="text-xs font-medium text-muted-foreground">{t("chooseRecipients")}</div>
          {team.length === 0 ? (
            <p className="text-xs text-muted-foreground">{t("noTeam")}</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {team.map((m) => {
                const on = to.includes(m.id);
                return (
                  <button
                    key={m.id}
                    type="button"
                    aria-pressed={on}
                    onClick={() => setTo((x) => (on ? x.filter((y) => y !== m.id) : [...x, m.id]))}
                    className={cn("inline-flex max-w-full items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition", on ? "border-violet-400 bg-violet-50 text-violet-800" : "bg-card text-foreground hover:border-violet-300")}
                    data-testid="recipient"
                  >
                    {on ? <Check className="size-3 shrink-0" /> : <Lock className="size-3 shrink-0 opacity-50" />}
                    <span className="truncate font-medium">{m.name}</span>
                    {m.title && <span className="hidden truncate text-muted-foreground sm:inline">· {m.title}</span>}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      <Textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && valid && !pending) send();
        }}
        maxLength={4000}
        rows={3}
        placeholder={
          !staff
            ? t("placeholderFamily")
            : vis === "SHARED"
              ? requesterSide
                ? t("placeholderTeam")
                : audience === "family"
                  ? t("placeholderShared")
                  : t("placeholderSharedRequester")
              : vis === "STAFF"
                ? t("placeholderStaff")
                : t("placeholderPrivate")
        }
        aria-label={t("messageLabel")}
        className="bg-card"
        data-testid="message-body"
      />

      {decision && (
        <div className="space-y-2 rounded-lg border border-violet-200 bg-violet-50/60 p-3" data-testid="notify-decision">
          <label className="flex items-start gap-2 text-sm">
            <Checkbox checked={notifyFamily} onCheckedChange={(v) => setNotifyFamily(v === true)} className="mt-0.5" data-testid="notify-family" />
            <span>
              <span className="font-medium">{t("notifyFamily")}</span>
              <span className="block text-xs text-muted-foreground">{t("notifyFamilyHelp")}</span>
            </span>
          </label>
          {notifyFamily && (
            <div className="space-y-1">
              <Label htmlFor="notify-reason" className="text-xs">
                {t("notifyReason")}
              </Label>
              <Textarea id="notify-reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} className="bg-card" data-testid="notify-reason" />
            </div>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
          <Info className="size-3" />
          {staff ? t("footStaff") : t("footFamily")}
        </span>
        <Button onClick={send} disabled={pending || !valid} data-testid="send-message">
          {pending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4 rtl:-scale-x-100" />}
          {!staff || (vis === "SHARED" && (requesterSide || audience !== "family")) ? t("sendReply") : vis === "SHARED" ? t("sendShared") : vis === "STAFF" ? t("sendStaff") : t("sendPrivate")}
        </Button>
      </div>
    </div>
  );
}
