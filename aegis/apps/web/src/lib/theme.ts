"use client";
import * as React from "react";

export type ThemeChoice = "dark" | "light" | "system";
const KEY = "aegis-theme";
const EVENT = "aegis-theme-change";

export function readChoice(): ThemeChoice {
  try {
    const v = localStorage.getItem(KEY);
    return v === "light" || v === "system" ? v : "dark";
  } catch {
    return "dark";
  }
}

export function applyChoice(choice: ThemeChoice) {
  try {
    localStorage.setItem(KEY, choice);
  } catch {
    // storage unavailable: the choice lasts for this page only
  }
  const resolved = choice === "system" ? (matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark") : choice;
  document.documentElement.dataset.theme = resolved;
  document.documentElement.classList.toggle("dark", resolved === "dark");
  window.dispatchEvent(new Event(EVENT));
}

const TOKENS = ["bg", "bg-elev", "bg-elev-2", "line", "line-strong", "fg", "fg-muted", "fg-dim", "accent", "allow", "deny", "approval", "info", "critical"] as const;
export type ThemeTokens = Record<(typeof TOKENS)[number], string>;

const DARK: ThemeTokens = { bg: "#0b0f17", "bg-elev": "#111826", "bg-elev-2": "#182236", line: "#223049", "line-strong": "#2f4166", fg: "#e6ebf5", "fg-muted": "#93a1ba", "fg-dim": "#5f6d87", accent: "#5b8def", allow: "#2fbf71", deny: "#e5484d", approval: "#f5a524", info: "#5b8def", critical: "#c43a7e" };

function read(): ThemeTokens {
  if (typeof window === "undefined") return DARK;
  const cs = getComputedStyle(document.documentElement);
  const out = { ...DARK };
  for (const t of TOKENS) {
    const v = cs.getPropertyValue(`--color-${t}`).trim();
    if (v) out[t] = v;
  }
  return out;
}

/** The current theme's colour tokens, for SVG charts and diagrams that cannot use CSS variables directly. */
export function useThemeTokens(): ThemeTokens {
  const [tokens, setTokens] = React.useState<ThemeTokens>(DARK);
  React.useEffect(() => {
    const update = () => setTokens(read());
    update();
    window.addEventListener(EVENT, update);
    return () => window.removeEventListener(EVENT, update);
  }, []);
  return tokens;
}
