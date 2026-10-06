"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Download, PlusSquare, Share, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { dismissInstall, installDismissed, isIos, isPhone, isStandalone, registerServiceWorker } from "./pwa-client";

type BeforeInstallPromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };

/** Registers the service worker for everyone signed in. */
export function PwaRegister() {
  useEffect(() => {
    void registerServiceWorker();
  }, []);
  return null;
}

/**
 * "Install the app" card for parents and students on phones. Android and other Chromium browsers get the
 * native install dialog; iOS Safari has none, so it shows the Share, Add to Home Screen steps instead.
 * Dismissing it is remembered on this device.
 */
export function InstallPrompt() {
  const t = useTranslations("devices.install");
  const [mode, setMode] = useState<"hidden" | "native" | "ios">("hidden");
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    if (isStandalone() || installDismissed() || !isPhone()) return;
    if (isIos()) {
      setMode("ios");
      return;
    }
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
      setMode("native");
    };
    const onInstalled = () => setMode("hidden");
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (mode === "hidden") return null;
  const close = () => {
    dismissInstall();
    setMode("hidden");
  };
  const install = async () => {
    if (!deferred) return;
    await deferred.prompt();
    const choice = await deferred.userChoice.catch(() => ({ outcome: "dismissed" as const }));
    if (choice.outcome === "accepted") setMode("hidden");
    setDeferred(null);
  };

  return (
    <div role="dialog" aria-labelledby="install-title" className="fixed inset-x-3 bottom-3 z-50 rounded-2xl border bg-card p-4 shadow-lg" data-testid="install-prompt">
      <div className="flex items-start gap-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/icon-192.png" alt="" className="size-11 shrink-0 rounded-xl" />
        <div className="min-w-0 flex-1">
          <p id="install-title" className="text-sm font-semibold">
            {t("title")}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">{t("body")}</p>
        </div>
        <button type="button" onClick={close} aria-label={t("dismiss")} className="-me-1 -mt-1 rounded-md p-1 text-muted-foreground hover:bg-muted" data-testid="install-dismiss">
          <X className="size-4" />
        </button>
      </div>
      {mode === "native" ? (
        <div className="mt-3 flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={close}>
            {t("later")}
          </Button>
          <Button size="sm" onClick={install} data-testid="install-now">
            <Download className="size-4" />
            {t("install")}
          </Button>
        </div>
      ) : (
        <ol className="mt-3 space-y-1.5 text-xs" data-testid="install-ios-steps">
          <li className="flex items-center gap-2">
            <Share className="size-4 shrink-0 text-brand" />
            {t("iosStep1")}
          </li>
          <li className="flex items-center gap-2">
            <PlusSquare className="size-4 shrink-0 text-brand" />
            {t("iosStep2")}
          </li>
        </ol>
      )}
    </div>
  );
}
