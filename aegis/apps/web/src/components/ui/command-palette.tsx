"use client";
import * as React from "react";
import { Dialog as RD } from "radix-ui";
import { Command } from "cmdk";
import { Search } from "lucide-react";
import { cn } from "@/lib/utils";

export interface PaletteItem {
  id: string;
  label: string;
  hint?: string;
  keywords?: string;
  disabled?: boolean;
  disabledReason?: string;
  onSelect: () => void;
}

export interface PaletteGroup {
  heading: string;
  items: PaletteItem[];
}

export function CommandPalette({ open, onOpenChange, groups, query, onQueryChange, loading, placeholder = "Search agents, people and pages" }: { open: boolean; onOpenChange: (o: boolean) => void; groups: PaletteGroup[]; query: string; onQueryChange: (q: string) => void; loading?: boolean; placeholder?: string }) {
  return (
    <RD.Root open={open} onOpenChange={onOpenChange}>
      <RD.Portal>
        <RD.Overlay className="fixed inset-0 z-50 bg-black/60" />
        <RD.Content className="fixed start-1/2 top-[12vh] z-50 w-[calc(100vw-32px)] max-w-xl -translate-x-1/2 overflow-hidden rounded-panel border border-line-strong bg-bg-elev shadow-2xl outline-none">
          <RD.Title className="sr-only">Command palette</RD.Title>
          <RD.Description className="sr-only">Search agents, people and navigation</RD.Description>
          <Command shouldFilter={false} label="Command palette">
            <div className="flex items-center gap-2 border-b border-line px-3">
              <Search className="h-4 w-4 text-fg-dim" aria-hidden />
              <Command.Input value={query} onValueChange={onQueryChange} placeholder={placeholder} className="h-11 w-full bg-transparent text-sm text-fg outline-none placeholder:text-fg-dim" />
              {loading ? <span className="text-xs text-fg-dim">Searching</span> : <kbd className="rounded border border-line bg-bg px-1.5 py-0.5 font-mono text-[10px] text-fg-dim">Esc</kbd>}
            </div>
            <Command.List className="max-h-[60vh] overflow-y-auto p-2">
              <Command.Empty className="px-3 py-8 text-center text-xs text-fg-dim">No results</Command.Empty>
              {groups.map((g) =>
                g.items.length ? (
                  <Command.Group key={g.heading} heading={g.heading} className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wide [&_[cmdk-group-heading]]:text-fg-dim">
                    {g.items.map((it) => (
                      <Command.Item key={it.id} value={it.id} disabled={it.disabled} onSelect={() => it.onSelect()} className={cn("flex cursor-default items-center justify-between gap-3 rounded-md px-2 py-2 text-sm text-fg outline-none data-[selected=true]:bg-bg-elev-2 data-[disabled=true]:opacity-50")}>
                        <span className="truncate">{it.label}</span>
                        <span className="shrink-0 text-xs text-fg-dim">{it.disabled && it.disabledReason ? it.disabledReason : it.hint}</span>
                      </Command.Item>
                    ))}
                  </Command.Group>
                ) : null,
              )}
            </Command.List>
          </Command>
        </RD.Content>
      </RD.Portal>
    </RD.Root>
  );
}
