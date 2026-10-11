"use client";
import * as React from "react";
import { DropdownMenu as RDM } from "radix-ui";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

export const DropdownMenu = RDM.Root;
export const DropdownMenuTrigger = RDM.Trigger;

export function DropdownMenuContent({ className, align = "end", children, ...props }: React.ComponentProps<typeof RDM.Content>) {
  return (
    <RDM.Portal>
      <RDM.Content align={align} sideOffset={6} className={cn("z-50 min-w-[180px] rounded-md border border-line-strong bg-bg-elev-2 p-1 shadow-xl", className)} {...props}>
        {children}
      </RDM.Content>
    </RDM.Portal>
  );
}

export function DropdownMenuItem({ className, danger, ...props }: React.ComponentProps<typeof RDM.Item> & { danger?: boolean }) {
  return <RDM.Item className={cn("flex cursor-default select-none items-center gap-2 rounded px-2 py-1.5 text-sm outline-none transition-colors duration-150 data-[highlighted]:bg-bg-elev data-[disabled]:opacity-50", danger ? "text-deny" : "text-fg", className)} {...props} />;
}

export function DropdownMenuCheckboxItem({ className, children, ...props }: React.ComponentProps<typeof RDM.CheckboxItem>) {
  return (
    <RDM.CheckboxItem className={cn("relative flex cursor-default select-none items-center rounded py-1.5 pe-2 ps-7 text-sm text-fg outline-none data-[highlighted]:bg-bg-elev", className)} {...props}>
      <RDM.ItemIndicator className="absolute start-2">
        <Check className="h-3.5 w-3.5 text-accent" aria-hidden />
      </RDM.ItemIndicator>
      {children}
    </RDM.CheckboxItem>
  );
}

export function DropdownMenuLabel({ className, ...props }: React.ComponentProps<typeof RDM.Label>) {
  return <RDM.Label className={cn("px-2 py-1.5 text-[11px] font-medium uppercase tracking-wide text-fg-dim", className)} {...props} />;
}

export function DropdownMenuSeparator({ className, ...props }: React.ComponentProps<typeof RDM.Separator>) {
  return <RDM.Separator className={cn("my-1 h-px bg-line", className)} {...props} />;
}
