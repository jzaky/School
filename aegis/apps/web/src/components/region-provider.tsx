"use client";
import * as React from "react";
import { DEFAULT_REGION, setRegion, type Region } from "@/lib/region";
import { navLabel, translate, type MessageKey } from "@/i18n/messages";

const RegionContext = React.createContext<Region>(DEFAULT_REGION);

/** Makes the organization's regional settings available to client components and client-side formatting. */
export function RegionProvider({ region, children }: { region: Region; children: React.ReactNode }) {
  // Set during render so formatting in this render already uses it in the browser.
  setRegion(region);
  return <RegionContext.Provider value={region}>{children}</RegionContext.Provider>;
}

export function useRegion(): Region {
  return React.useContext(RegionContext);
}

export function useT() {
  const { locale } = useRegion();
  return React.useMemo(() => ({ t: (key: MessageKey, vars?: Record<string, string | number>) => translate(locale, key, vars), nav: (english: string) => navLabel(locale, english), locale }), [locale]);
}
