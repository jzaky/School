"use client";
import * as React from "react";
import { Tabs as RT } from "radix-ui";
import { cn } from "@/lib/utils";

export const Tabs = RT.Root;
export const TabsContent = RT.Content;

export function TabsList({ className, ...props }: React.ComponentProps<typeof RT.List>) {
  return <RT.List className={cn("mb-4 flex flex-wrap gap-1 border-b border-line", className)} {...props} />;
}

export function TabsTrigger({ className, count, children, ...props }: React.ComponentProps<typeof RT.Trigger> & { count?: number }) {
  return (
    <RT.Trigger className={cn("-mb-px inline-flex h-9 items-center gap-1.5 border-b-2 border-transparent px-3 text-sm text-fg-muted outline-none transition-colors duration-150 hover:text-fg data-[state=active]:border-accent data-[state=active]:text-fg focus-visible:bg-bg-elev-2", className)} {...props}>
      {children}
      {typeof count === "number" ? <span className="rounded bg-bg-elev-2 px-1.5 text-[11px] tabular text-fg-muted">{count}</span> : null}
    </RT.Trigger>
  );
}
