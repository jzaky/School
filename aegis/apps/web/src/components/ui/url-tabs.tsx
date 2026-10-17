"use client";
import * as React from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./tabs";

export interface UrlTab {
  id: string;
  label: string;
  count?: number;
  content: React.ReactNode;
}

/** Tabs that remember the active tab in the URL (?tab=) without a server round-trip. */
export function UrlTabs({ tabs, initial, label, param = "tab" }: { tabs: UrlTab[]; initial?: string; label: string; param?: string }) {
  const valid = tabs.some((t) => t.id === initial) ? initial! : tabs[0]!.id;
  const [value, setValue] = React.useState(valid);
  return (
    <Tabs
      value={value}
      onValueChange={(v) => {
        setValue(v);
        const url = new URL(window.location.href);
        url.searchParams.set(param, v);
        window.history.replaceState(window.history.state, "", url.toString());
      }}
    >
      <TabsList aria-label={label}>
        {tabs.map((t) => (
          <TabsTrigger key={t.id} value={t.id} count={t.count}>
            {t.label}
          </TabsTrigger>
        ))}
      </TabsList>
      {tabs.map((t) => (
        <TabsContent key={t.id} value={t.id} className="outline-none">
          {t.content}
        </TabsContent>
      ))}
    </Tabs>
  );
}
