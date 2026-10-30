"use client";
import * as React from "react";
import { Check, Copy } from "lucide-react";
import { cn } from "@/lib/utils";
import { IconButton } from "./button";

export function CopyButton({ value, label = "Copy", size = "sm" }: { value: string; label?: string; size?: "sm" | "md" }) {
  const [copied, setCopied] = React.useState(false);
  return (
    <IconButton
      label={copied ? "Copied" : label}
      size={size}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          // Clipboard access denied: nothing to do, the value stays visible on screen.
        }
      }}
    >
      {copied ? <Check className="h-3.5 w-3.5 text-allow" aria-hidden /> : <Copy className="h-3.5 w-3.5" aria-hidden />}
    </IconButton>
  );
}

export function CodeBlock({ code, className, wrap, copy = true, label }: { code: string; className?: string; wrap?: boolean; copy?: boolean; label?: string }) {
  return (
    <div className={cn("group relative rounded-md border border-line bg-bg", className)}>
      {label ? <div className="border-b border-line px-3 py-1 text-[11px] uppercase tracking-wide text-fg-dim">{label}</div> : null}
      <pre className={cn("overflow-x-auto p-3 pe-10 font-mono text-xs leading-5 text-fg", wrap && "whitespace-pre-wrap break-all")}>{code}</pre>
      {copy ? (
        <div className="absolute end-1.5 top-1.5">
          <CopyButton value={code} />
        </div>
      ) : null}
    </div>
  );
}

export function Mono({ children, className }: { children: React.ReactNode; className?: string }) {
  return <span className={cn("font-mono text-xs text-fg-muted", className)}>{children}</span>;
}
