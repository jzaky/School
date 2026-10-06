"use client";

// Browser helpers for the installable app: service worker registration and platform checks.

let registration: Promise<ServiceWorkerRegistration | null> | null = null;

/** Registers /sw.js once per page load. Resolves to null where service workers are not available. */
export function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return Promise.resolve(null);
  registration ??= navigator.serviceWorker
    .register("/sw.js", { scope: "/" })
    .then(() => navigator.serviceWorker.ready)
    .catch(() => null);
  return registration;
}

export function isIos() {
  if (typeof navigator === "undefined") return false;
  // iPadOS reports itself as a Mac with touch.
  return /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

export function isStandalone() {
  if (typeof window === "undefined") return false;
  return window.matchMedia?.("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

export function isPhone() {
  if (typeof window === "undefined") return false;
  return window.matchMedia?.("(max-width: 820px)").matches && ("ontouchstart" in window || navigator.maxTouchPoints > 0);
}

const DISMISS_KEY = "horizon.install.dismissed";

export function installDismissed() {
  try {
    return localStorage.getItem(DISMISS_KEY) === "1";
  } catch {
    return false;
  }
}

export function dismissInstall() {
  try {
    localStorage.setItem(DISMISS_KEY, "1");
  } catch {
    // Private mode: the prompt simply shows again next time.
  }
}
