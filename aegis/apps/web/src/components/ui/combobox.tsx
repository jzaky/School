"use client";
import * as React from "react";
import { Popover } from "radix-ui";
import { Command } from "cmdk";
import { Check, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";

export interface ComboOption {
  value: string;
  label: string;
  description?: string;
  disabled?: boolean;
}

export function Combobox({ value, onChange, options, placeholder = "Select", searchPlaceholder = "Search", emptyText = "No matches", disabled, id, className, allowClear }: { value: string | null; onChange: (v: string | null) => void; options: ComboOption[]; placeholder?: string; searchPlaceholder?: string; emptyText?: string; disabled?: boolean; id?: string; className?: string; allowClear?: boolean }) {
  const [open, setOpen] = React.useState(false);
  const selected = options.find((o) => o.value === value);
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button id={id} type="button" role="combobox" aria-expanded={open} aria-controls={open ? `${id ?? "combobox"}-list` : undefined} disabled={disabled} className={cn("inline-flex h-8 w-full items-center justify-between gap-2 rounded-md border border-line bg-bg px-2.5 text-start text-sm outline-none transition-colors duration-150 focus:border-accent disabled:cursor-not-allowed disabled:opacity-50", selected ? "text-fg" : "text-fg-dim", className)}>
          <span className="truncate">{selected ? selected.label : placeholder}</span>
          <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-fg-dim" aria-hidden />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content align="start" sideOffset={4} className="z-50 w-[var(--radix-popover-trigger-width)] min-w-[240px] rounded-md border border-line-strong bg-bg-elev-2 shadow-xl">
          <Command className="text-sm">
            <Command.Input placeholder={searchPlaceholder} className="h-9 w-full border-b border-line bg-transparent px-3 text-sm text-fg outline-none placeholder:text-fg-dim" />
            <Command.List id={`${id ?? "combobox"}-list`} className="max-h-64 overflow-y-auto p-1">
              <Command.Empty className="px-3 py-4 text-center text-xs text-fg-dim">{emptyText}</Command.Empty>
              {allowClear && value ? (
                <Command.Item
                  value="__clear__"
                  onSelect={() => {
                    onChange(null);
                    setOpen(false);
                  }}
                  className="cursor-default rounded px-2 py-1.5 text-xs text-fg-muted data-[selected=true]:bg-bg-elev"
                >
                  Clear selection
                </Command.Item>
              ) : null}
              {options.map((o) => (
                <Command.Item
                  key={o.value}
                  value={`${o.label} ${o.description ?? ""} ${o.value}`}
                  disabled={o.disabled}
                  onSelect={() => {
                    onChange(o.value);
                    setOpen(false);
                  }}
                  className="flex cursor-default items-center justify-between gap-2 rounded px-2 py-1.5 text-fg outline-none data-[selected=true]:bg-bg-elev data-[disabled=true]:opacity-50"
                >
                  <span className="min-w-0">
                    <span className="block truncate">{o.label}</span>
                    {o.description ? <span className="block truncate text-xs text-fg-muted">{o.description}</span> : null}
                  </span>
                  {o.value === value ? <Check className="h-3.5 w-3.5 shrink-0 text-accent" aria-hidden /> : null}
                </Command.Item>
              ))}
            </Command.List>
          </Command>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
