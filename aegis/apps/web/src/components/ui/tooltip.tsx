"use client";
import * as React from "react";
import { Tooltip as RT } from "radix-ui";
import { cn } from "@/lib/utils";

export function TooltipProvider({ children }: { children: React.ReactNode }) {
  return <RT.Provider delayDuration={200} skipDelayDuration={100}>{children}</RT.Provider>;
}

export function Tooltip({ content, children, side = "top", align = "center", className }: { content: React.ReactNode; children: React.ReactNode; side?: "top" | "bottom" | "left" | "right"; align?: "start" | "center" | "end"; className?: string }) {
  if (!content) return <>{children}</>;
  return (
    <RT.Root>
      <RT.Trigger asChild>{children}</RT.Trigger>
      <RT.Portal>
        <RT.Content side={side} align={align} sideOffset={6} className={cn("z-50 max-w-xs rounded-md border border-line-strong bg-bg-elev-2 px-2.5 py-1.5 text-xs text-fg shadow-lg", "data-[state=delayed-open]:animate-in", className)}>
          {content}
          <RT.Arrow className="fill-bg-elev-2" />
        </RT.Content>
      </RT.Portal>
    </RT.Root>
  );
}
