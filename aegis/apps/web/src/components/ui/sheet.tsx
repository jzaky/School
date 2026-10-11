"use client";
import * as React from "react";
import { Dialog as RD } from "radix-ui";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { IconButton } from "./button";

export function Sheet({ open, onOpenChange, title, description, children, footer, side = "end", className, trigger, width = "md" }: { open?: boolean; onOpenChange?: (o: boolean) => void; title: React.ReactNode; description?: React.ReactNode; children: React.ReactNode; footer?: React.ReactNode; side?: "start" | "end"; className?: string; trigger?: React.ReactNode; width?: "sm" | "md" | "lg" }) {
  return (
    <RD.Root open={open} onOpenChange={onOpenChange}>
      {trigger ? <RD.Trigger asChild>{trigger}</RD.Trigger> : null}
      <RD.Portal>
        <RD.Overlay className="fixed inset-0 z-50 bg-black/60" />
        <RD.Content className={cn("fixed inset-y-0 z-50 flex w-[calc(100vw-32px)] flex-col border-line-strong bg-bg-elev shadow-2xl outline-none transition-transform duration-200 ease-out", side === "end" ? "end-0 border-s" : "start-0 border-e", width === "sm" ? "max-w-sm" : width === "lg" ? "max-w-2xl" : "max-w-lg", className)}>
          <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
            <div className="min-w-0">
              <RD.Title className="text-base font-semibold text-fg">{title}</RD.Title>
              {description ? <RD.Description className="mt-1 text-xs text-fg-muted">{description}</RD.Description> : <RD.Description className="sr-only">Panel</RD.Description>}
            </div>
            <RD.Close asChild>
              <IconButton label="Close" size="sm">
                <X className="h-4 w-4" aria-hidden />
              </IconButton>
            </RD.Close>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
          {footer ? <div className="flex items-center justify-end gap-2 border-t border-line px-5 py-3">{footer}</div> : null}
        </RD.Content>
      </RD.Portal>
    </RD.Root>
  );
}
