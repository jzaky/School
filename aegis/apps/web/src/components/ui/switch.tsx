"use client";
import * as React from "react";
import { Switch as RSw } from "radix-ui";
import { cn } from "@/lib/utils";

export function Switch({ checked, defaultChecked, onCheckedChange, disabled, id, name, className, "aria-label": ariaLabel }: { checked?: boolean; defaultChecked?: boolean; onCheckedChange?: (v: boolean) => void; disabled?: boolean; id?: string; name?: string; className?: string; "aria-label"?: string }) {
  return (
    <RSw.Root id={id} name={name} checked={checked} defaultChecked={defaultChecked} onCheckedChange={onCheckedChange} disabled={disabled} aria-label={ariaLabel} className={cn("relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border border-line-strong bg-bg-elev-2 transition-colors duration-150 data-[state=checked]:border-accent data-[state=checked]:bg-accent disabled:cursor-not-allowed disabled:opacity-50", className)}>
      <RSw.Thumb className="block h-3.5 w-3.5 translate-x-0.5 rounded-full bg-fg transition-transform duration-150 data-[state=checked]:translate-x-[18px] data-[state=checked]:bg-white" />
    </RSw.Root>
  );
}

export function Checkbox({ checked, onCheckedChange, disabled, id, name, label, description, value }: { checked: boolean; onCheckedChange: (v: boolean) => void; disabled?: boolean; id?: string; name?: string; label: React.ReactNode; description?: React.ReactNode; value?: string }) {
  return (
    <label className={cn("flex cursor-pointer items-start gap-2.5 rounded-md px-2 py-1.5 hover:bg-bg-elev-2", disabled && "cursor-not-allowed opacity-50")}>
      <input type="checkbox" id={id} name={name} value={value} checked={checked} disabled={disabled} onChange={(e) => onCheckedChange(e.target.checked)} className="mt-0.5 h-3.5 w-3.5 accent-[var(--color-accent)]" />
      <span className="min-w-0">
        <span className="block text-sm text-fg">{label}</span>
        {description ? <span className="block text-xs text-fg-muted">{description}</span> : null}
      </span>
    </label>
  );
}
