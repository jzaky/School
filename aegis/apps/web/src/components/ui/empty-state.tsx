import * as React from "react";
import type { LucideIcon } from "lucide-react";
import { Inbox } from "lucide-react";
import { cn } from "@/lib/utils";

export function EmptyState({ title, description, icon: Icon = Inbox, action, className }: { title: string; description?: React.ReactNode; icon?: LucideIcon; action?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col items-center justify-center gap-2 px-6 py-12 text-center", className)}>
      <div className="grid h-10 w-10 place-items-center rounded-lg border border-line bg-bg-elev-2 text-fg-dim">
        <Icon className="h-5 w-5" aria-hidden />
      </div>
      <div className="text-sm font-medium text-fg">{title}</div>
      {description ? <p className="max-w-md text-xs text-fg-muted">{description}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}
