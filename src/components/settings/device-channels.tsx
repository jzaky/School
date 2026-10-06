"use client";

import { useEffect, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { BellRing, Loader2, Lock, MessageCircle, Smartphone } from "lucide-react";
import type { NotificationChannel } from "@prisma/client";
import { useRouter } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { optInWhatsAppAction, optOutWhatsAppAction, setChannelPreferenceAction, subscribePushAction, unsubscribePushAction } from "@/server/notify/device-actions";
import { isIos, isStandalone, registerServiceWorker } from "@/components/pwa/pwa-client";

function urlBase64ToUint8Array(base64: string) {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

type PushState = "checking" | "unsupported" | "iosInstall" | "denied" | "off" | "on";

/** Opt in to push notifications on this device. Shown only when the server has VAPID keys. */
export function PushDevice({ publicKey, endpoints }: { publicKey: string; endpoints: string[] }) {
  const t = useTranslations("devices.push");
  const router = useRouter();
  const [state, setState] = useState<PushState>("checking");
  const [pending, start] = useTransition();

  useEffect(() => {
    let alive = true;
    (async () => {
      const supported = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
      if (!supported) return alive && setState(isIos() && !isStandalone() ? "iosInstall" : "unsupported");
      if (Notification.permission === "denied") return alive && setState("denied");
      const reg = await registerServiceWorker();
      const sub = await reg?.pushManager.getSubscription();
      if (alive) setState(sub && endpoints.includes(sub.endpoint) ? "on" : "off");
    })().catch(() => alive && setState("unsupported"));
    return () => {
      alive = false;
    };
  }, [endpoints]);

  const turnOn = () =>
    start(async () => {
      try {
        const permission = await Notification.requestPermission();
        if (permission !== "granted") {
          setState(permission === "denied" ? "denied" : "off");
          return;
        }
        const reg = await registerServiceWorker();
        if (!reg) throw new Error("no_sw");
        const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicKey) }));
        const json = sub.toJSON() as { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
        const res = await subscribePushAction({ endpoint: json.endpoint ?? sub.endpoint, p256dh: json.keys?.p256dh ?? "", auth: json.keys?.auth ?? "", deviceLabel: navigator.userAgent.includes("Mobile") ? "phone" : "browser" });
        if (!res.ok) throw new Error(res.error);
        setState("on");
        toast.success(t("onToast"));
        router.refresh();
      } catch {
        toast.error(t("error"));
      }
    });

  const turnOff = () =>
    start(async () => {
      const reg = await registerServiceWorker();
      const sub = await reg?.pushManager.getSubscription();
      if (sub) {
        await unsubscribePushAction({ endpoint: sub.endpoint });
        await sub.unsubscribe().catch(() => undefined);
      }
      setState("off");
      toast.success(t("offToast"));
      router.refresh();
    });

  return (
    <div className="flex flex-col gap-3 rounded-lg border p-4 sm:flex-row sm:items-center" data-testid="push-device">
      <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-brand-soft text-brand">
        <BellRing className="size-5" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{t("title")}</p>
        <p className="text-xs text-muted-foreground">{t(`state.${state}`)}</p>
      </div>
      {state === "on" ? (
        <Button variant="outline" size="sm" onClick={turnOff} disabled={pending} data-testid="push-off">
          {pending && <Loader2 className="size-4 animate-spin" />}
          {t("turnOff")}
        </Button>
      ) : state === "off" ? (
        <Button size="sm" onClick={turnOn} disabled={pending} data-testid="push-on">
          {pending && <Loader2 className="size-4 animate-spin" />}
          {t("turnOn")}
        </Button>
      ) : null}
    </div>
  );
}

/** Parents opt in to WhatsApp with a number and an explicit consent tick. */
export function WhatsAppOptInForm({ optIn, defaultPhone, kinds }: { optIn: { masked: string; since: string } | null; defaultPhone: string; kinds: string[] }) {
  const t = useTranslations("devices.whatsapp");
  const router = useRouter();
  const [phone, setPhone] = useState(defaultPhone);
  const [consent, setConsent] = useState(false);
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, ok: string) =>
    start(async () => {
      const res = await fn();
      if (res.ok) {
        toast.success(ok);
        router.refresh();
      } else toast.error(res.error && t.has(`error.${res.error}`) ? t(`error.${res.error}`) : t("error.generic"));
    });
  return (
    <div className="rounded-lg border p-4" data-testid="whatsapp-optin">
      <div className="flex items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-emerald-50 text-emerald-700">
          <MessageCircle className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">{t("title")}</p>
          <p className="text-xs text-muted-foreground">{t("hint", { kinds: kinds.join(t("listSeparator")) })}</p>
        </div>
      </div>
      {optIn ? (
        <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm">
            {t("onFor")}{" "}
            <span dir="ltr" className="font-medium">
              {optIn.masked}
            </span>
            <span className="block text-xs text-muted-foreground">{t("since", { date: optIn.since })}</span>
          </p>
          <Button variant="outline" size="sm" disabled={pending} onClick={() => run(() => optOutWhatsAppAction(), t("offToast"))} data-testid="whatsapp-off">
            {t("turnOff")}
          </Button>
        </div>
      ) : (
        <div className="mt-3 space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="wa-phone">{t("phone")}</Label>
            <Input id="wa-phone" dir="ltr" inputMode="tel" autoComplete="tel" placeholder="+971 50 000 0000" value={phone} onChange={(e) => setPhone(e.target.value)} className="max-w-xs" />
          </div>
          <label className="flex items-start gap-2 text-sm">
            <Checkbox checked={consent} onCheckedChange={(v) => setConsent(v === true)} className="mt-0.5" data-testid="whatsapp-consent" />
            <span>{t("consent")}</span>
          </label>
          <Button size="sm" disabled={pending || !consent || !phone.trim()} onClick={() => run(() => optInWhatsAppAction({ phone, consent }), t("onToast"))} data-testid="whatsapp-on">
            {pending && <Loader2 className="size-4 animate-spin" />}
            {t("turnOn")}
          </Button>
        </div>
      )}
    </div>
  );
}

export type PrefRow = { kind: string; label: string; channels: Partial<Record<NotificationChannel, boolean>>; whatsapp: boolean };

/** Per-kind channel switches. Columns appear only for channels this member can actually receive. */
export function ChannelPreferences({ kinds, locked, emailEnabled, showPush, showWhatsApp }: { kinds: PrefRow[]; locked: Array<{ kind: string; label: string }>; emailEnabled: boolean; showPush: boolean; showWhatsApp: boolean }) {
  const t = useTranslations("settings");
  const td = useTranslations("devices");
  const [state, setState] = useState(() => Object.fromEntries(kinds.map((k) => [k.kind, k.channels])));
  const [, start] = useTransition();
  const cols: NotificationChannel[] = ["EMAIL", ...(showPush ? (["PUSH"] as const) : []), ...(showWhatsApp ? (["WHATSAPP"] as const) : [])];
  const grid = { gridTemplateColumns: `minmax(0,1fr) repeat(${cols.length + 1}, 56px)` };
  const label = (c: NotificationChannel) => (c === "EMAIL" ? t("email") : c === "PUSH" ? td("pushColumn") : td("whatsappColumn"));
  const toggle = (kind: string, channel: NotificationChannel, on: boolean) => {
    setState((s) => ({ ...s, [kind]: { ...s[kind], [channel]: on } }));
    start(async () => {
      const res = await setChannelPreferenceAction({ kind, channel, on });
      if (res.ok) toast.success(t("saved"));
      else {
        toast.error(t("error"));
        setState((s) => ({ ...s, [kind]: { ...s[kind], [channel]: !on } }));
      }
    });
  };
  return (
    <div className="divide-y">
      <div className="grid gap-2 pb-2 text-xs font-medium text-muted-foreground" style={grid}>
        <span>{t("kind")}</span>
        <span className="text-center">{t("inApp")}</span>
        {cols.map((c) => (
          <span key={c} className="text-center">
            {label(c)}
          </span>
        ))}
      </div>
      {kinds.map((k) => (
        <div key={k.kind} className="grid items-center gap-2 py-3" style={grid}>
          <span className="text-sm">{k.label}</span>
          <span className="flex justify-center">
            <Switch checked disabled aria-label={`${k.label}: ${t("inApp")}`} />
          </span>
          {cols.map((c) =>
            c === "WHATSAPP" && !k.whatsapp ? (
              <span key={c} className="text-center text-xs text-muted-foreground" title={td("whatsappNotOffered")}>
                -
              </span>
            ) : (
              <span key={c} className="flex justify-center">
                <Switch
                  checked={state[k.kind]?.[c] ?? true}
                  aria-label={`${k.label}: ${label(c)}`}
                  data-testid={c === "EMAIL" ? `pref-${k.kind}` : `pref-${k.kind}-${c.toLowerCase()}`}
                  onCheckedChange={(v) => toggle(k.kind, c, v)}
                />
              </span>
            ),
          )}
        </div>
      ))}
      {locked.map((k) => (
        <div key={k.kind} className="grid items-center gap-2 py-3" style={grid}>
          <span className="flex items-center gap-1.5 text-sm">
            <Lock className="size-3.5 text-muted-foreground" />
            {k.label}
          </span>
          <span className="text-center text-xs text-muted-foreground" style={{ gridColumn: `span ${cols.length + 1}` }}>
            {t("alwaysOn")}
          </span>
        </div>
      ))}
      <p className="flex items-start gap-1.5 pt-3 text-xs text-muted-foreground">
        <Smartphone className="mt-0.5 size-3.5 shrink-0" />
        <span>
          {emailEnabled ? t("inAppHint") : t("emailDemoHint")} {showPush || showWhatsApp ? td("privateHint") : ""}
        </span>
      </p>
    </div>
  );
}
