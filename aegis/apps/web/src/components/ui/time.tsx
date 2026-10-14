"use client";
import * as React from "react";
import { useRegion } from "@/components/region-provider";
import { formatDateTime, timeAgo } from "@/lib/utils";

/**
 * Relative time that is rendered on the server and refreshed on the client.
 * The text can differ by a few seconds between the two, so hydration warnings are suppressed for it.
 */
export function TimeAgo({ value, className }: { value: string | Date | null | undefined; className?: string }) {
  const region = useRegion();
  const [text, setText] = React.useState(() => timeAgo(value));
  React.useEffect(() => {
    setText(timeAgo(value));
    const t = setInterval(() => setText(timeAgo(value)), 30_000);
    return () => clearInterval(t);
  }, [value]);
  if (!value) return <span className="text-fg-dim">never</span>;
  const iso = typeof value === "string" ? value : value.toISOString();
  return (
    <time dateTime={iso} title={formatDateTime(value, region)} className={className} suppressHydrationWarning>
      {text}
    </time>
  );
}

/** Absolute timestamp in the organization's time zone and the viewer's console language. */
export function DateTime({ value, className }: { value: string | Date | null | undefined; className?: string }) {
  const region = useRegion();
  const [text, setText] = React.useState(() => formatDateTime(value, region));
  React.useEffect(() => setText(formatDateTime(value, region)), [value, region]);
  if (!value) return <span className="text-fg-dim">never</span>;
  const iso = typeof value === "string" ? value : value.toISOString();
  return (
    <time dateTime={iso} className={className} suppressHydrationWarning>
      {text}
    </time>
  );
}
