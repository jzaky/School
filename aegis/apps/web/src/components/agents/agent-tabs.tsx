"use client";
import * as React from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export interface AgentTab {
  id: string;
  label: string;
  count?: number;
  content: React.ReactNode;
}

export function AgentTabs({ tabs, initial }: { tabs: AgentTab[]; initial?: string }) {
  const valid = tabs.some((t) => t.id === initial) ? initial! : tabs[0]!.id;
  const [value, setValue] = React.useState(valid);
  return (
    <Tabs
      value={value}
      onValueChange={(v) => {
        setValue(v);
        // Keep the tab in the URL for deep links without a server round-trip (the App Router syncs native history updates).
        const url = new URL(window.location.href);
        url.searchParams.set("tab", v);
        window.history.replaceState(window.history.state, "", url.toString());
      }}
    >
      <TabsList aria-label="Agent sections">
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
