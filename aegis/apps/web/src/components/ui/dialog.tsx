"use client";
import * as React from "react";
import { Dialog as RD } from "radix-ui";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { IconButton } from "./button";

export const DialogRoot = RD.Root;
export const DialogTrigger = RD.Trigger;
export const DialogClose = RD.Close;

export function DialogContent({ title, description, children, footer, className, size = "md" }: { title: React.ReactNode; description?: React.ReactNode; children?: React.ReactNode; footer?: React.ReactNode; className?: string; size?: "sm" | "md" | "lg" }) {
  return (
    <RD.Portal>
      <RD.Overlay className="fixed inset-0 z-50 bg-black/60 data-[state=open]:animate-in" />
      <RD.Content className={cn("fixed start-1/2 top-1/2 z-50 flex max-h-[90vh] w-[calc(100vw-32px)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-panel border border-line-strong bg-bg-elev shadow-2xl outline-none", size === "sm" ? "max-w-sm" : size === "lg" ? "max-w-2xl" : "max-w-lg", className)}>
        <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
          <div className="min-w-0">
            <RD.Title className="text-base font-semibold text-fg">{title}</RD.Title>
            {description ? <RD.Description className="mt-1 text-xs text-fg-muted">{description}</RD.Description> : <RD.Description className="sr-only">{typeof title === "string" ? title : "Dialog"}</RD.Description>}
          </div>
          <RD.Close asChild>
            <IconButton label="Close" size="sm">
              <X className="h-4 w-4" aria-hidden />
            </IconButton>
          </RD.Close>
        </div>
        {children ? <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div> : null}
        {footer ? <div className="flex items-center justify-end gap-2 border-t border-line px-5 py-3">{footer}</div> : null}
      </RD.Content>
    </RD.Portal>
  );
}

export function Dialog({ open, onOpenChange, trigger, ...content }: { open?: boolean; onOpenChange?: (o: boolean) => void; trigger?: React.ReactNode } & React.ComponentProps<typeof DialogContent>) {
  return (
    <RD.Root open={open} onOpenChange={onOpenChange}>
      {trigger ? <RD.Trigger asChild>{trigger}</RD.Trigger> : null}
      <DialogContent {...content} />
    </RD.Root>
  );
}
