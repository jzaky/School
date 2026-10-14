import { currentRegion } from "@/lib/region";
import { computedLabel, navLabel, translate, type MessageKey } from "./messages";

/** Translation for server components, in the language set for this request by getConsoleContext. */
export function t(key: MessageKey, vars?: Record<string, string | number>): string {
  return translate(currentRegion().locale, key, vars);
}

export function tNav(english: string): string {
  return navLabel(currentRegion().locale, english);
}

export function tLabel(id: string, english: string): string {
  return computedLabel(currentRegion().locale, id, english);
}
