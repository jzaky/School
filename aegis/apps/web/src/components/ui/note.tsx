import * as React from "react";
import { Info, AlertTriangle, ShieldAlert } from "lucide-react";
import { cn } from "@/lib/utils";

/** Short explanatory callout. Keep the text to one or two sentences. */
export function Note({ children, tone = "info", className }: { children: React.ReactNode; tone?: "info" | "warning" | "danger"; className?: string }) {
  const Icon = tone === "danger" ? ShieldAlert : tone === "warning" ? AlertTriangle : Info;
  const cls = tone === "danger" ? "border-deny/30 bg-deny/10" : tone === "warning" ? "border-approval/30 bg-approval/10" : "border-info/30 bg-info/10";
  const iconCls = tone === "danger" ? "text-deny" : tone === "warning" ? "text-approval" : "text-info";
  return (
    <div role="note" className={cn("flex gap-2 rounded-md border px-3 py-2 text-xs text-fg", cls, className)}>
      <Icon className={cn("mt-0.5 h-3.5 w-3.5 shrink-0", iconCls)} aria-hidden />
      <div className="min-w-0">{children}</div>
    </div>
  );
}
