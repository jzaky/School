import { HEX_COLOR } from "@/lib/onboarding";

// The app's own theme was tuned by hand for these colors (schema default and the demo school), so schools that
// keep them get exactly that theme. Any other brand color is applied as CSS variables across the app shell.
const BUILT_IN_PRIMARY = new Set(["#0F4C81", "#123A63"]);
const BUILT_IN_ACCENT = new Set(["#C8A24A"]);

/** CSS variables for a school's brand colors, or an empty string when the built-in theme applies. */
export function brandCss(primaryColor: string, accentColor: string): string {
  const p = primaryColor.toUpperCase();
  const a = accentColor.toUpperCase();
  const vars: string[] = [];
  if (HEX_COLOR.test(p) && !BUILT_IN_PRIMARY.has(p)) {
    vars.push(
      `--brand:${p}`,
      `--primary:${p}`,
      `--ring:color-mix(in oklch, ${p} 75%, white)`,
      `--brand-soft:color-mix(in oklch, ${p} 10%, white)`,
      `--sidebar:color-mix(in oklch, ${p} 55%, black)`,
      `--sidebar-accent:color-mix(in oklch, ${p} 70%, black)`,
      `--sidebar-border:color-mix(in oklch, ${p} 62%, black)`,
    );
  }
  if (HEX_COLOR.test(a) && !BUILT_IN_ACCENT.has(a)) vars.push(`--gold:${a}`, `--gold-soft:color-mix(in oklch, ${a} 15%, white)`);
  return vars.length ? `:root{${vars.join(";")}}` : "";
}

/** Apply the school's brand colors. Values are validated hex colors, so nothing else can reach the style tag. */
export function BrandStyle({ primaryColor, accentColor }: { primaryColor: string; accentColor: string }) {
  const css = brandCss(primaryColor, accentColor);
  if (!css) return null;
  return <style data-testid="brand-style">{css}</style>;
}
