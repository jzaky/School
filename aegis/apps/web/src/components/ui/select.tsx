"use client";
import * as React from "react";
import { Select as RS } from "radix-ui";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

export interface SelectOption {
  value: string;
  label: React.ReactNode;
  disabled?: boolean;
}

export function Select({ value, defaultValue, onValueChange, options, placeholder = "Select", name, id, disabled, className, size = "md", "aria-label": ariaLabel }: { value?: string; defaultValue?: string; onValueChange?: (v: string) => void; options: SelectOption[]; placeholder?: string; name?: string; id?: string; disabled?: boolean; className?: string; size?: "sm" | "md"; "aria-label"?: string }) {
  // Controlled selects render their label on the server too, so the trigger is never blank before hydration.
  const current = value !== undefined ? options.find((o) => o.value === value) : undefined;
  return (
    <RS.Root value={value} defaultValue={defaultValue} onValueChange={onValueChange} name={name} disabled={disabled}>
      <RS.Trigger id={id} aria-label={ariaLabel} className={cn("inline-flex w-full items-center justify-between gap-2 rounded-md border border-line bg-bg px-2.5 text-start text-sm text-fg outline-none transition-colors duration-150 focus:border-accent disabled:cursor-not-allowed disabled:opacity-50 data-[placeholder]:text-fg-dim", size === "sm" ? "h-7 text-xs" : "h-8", className)}>
        <span className="truncate">
          <RS.Value placeholder={placeholder}>{current?.label}</RS.Value>
        </span>
        <RS.Icon>
          <ChevronDown className="h-3.5 w-3.5 text-fg-dim" aria-hidden />
        </RS.Icon>
      </RS.Trigger>
      <RS.Portal>
        <RS.Content position="popper" sideOffset={4} className="z-50 max-h-72 min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-md border border-line-strong bg-bg-elev-2 shadow-xl">
          <RS.Viewport className="p-1">
            {options.map((o) => (
              <RS.Item key={o.value} value={o.value} disabled={o.disabled} className="relative flex cursor-default select-none items-center rounded px-2 py-1.5 pe-7 text-sm text-fg outline-none data-[highlighted]:bg-bg-elev data-[disabled]:opacity-50">
                <RS.ItemText>{o.label}</RS.ItemText>
                <RS.ItemIndicator className="absolute end-2">
                  <Check className="h-3.5 w-3.5 text-accent" aria-hidden />
                </RS.ItemIndicator>
              </RS.Item>
            ))}
          </RS.Viewport>
        </RS.Content>
      </RS.Portal>
    </RS.Root>
  );
}

/** Plain native select for forms that post FormData without client state. */
export function NativeSelect({ className, children, ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <div className="relative">
      <select className={cn("h-8 w-full appearance-none rounded-md border border-line bg-bg px-2.5 pe-8 text-sm text-fg outline-none transition-colors duration-150 focus:border-accent disabled:cursor-not-allowed disabled:opacity-50", className)} {...props}>
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute end-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-fg-dim" aria-hidden />
    </div>
  );
}
