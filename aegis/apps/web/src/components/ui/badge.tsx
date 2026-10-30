import * as React from "react";
import { cn } from "@/lib/utils";
import { TONE_SOFT, type Tone } from "@/lib/status";

export function Badge({ tone = "neutral", className, children, mono }: { tone?: Tone; className?: string; children: React.ReactNode; mono?: boolean }) {
  return <span className={cn("inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-medium leading-4", TONE_SOFT[tone], mono && "font-mono", className)}>{children}</span>;
}
