"use client";
import * as React from "react";
import { formatDateTime, timeAgo } from "@/lib/utils";

/**
 * Relative time that is rendered on the server and refreshed on the client.
 * The text can differ by a few seconds between the two, so hydration warnings are suppressed for it.
 */
export function TimeAgo({ value, className }: { value: string | Date | null | undefined; className?: string }) {
  const [text, setText] = React.useState(() => timeAgo(value));
  React.useEffect(() => {
    setText(timeAgo(value));
    const t = setInterval(() => setText(timeAgo(value)), 30_000);
    return () => clearInterval(t);
  }, [value]);
  if (!value) return <span className="text-fg-dim">never</span>;
  const iso = typeof value === "string" ? value : value.toISOString();
  return (
    <time dateTime={iso} title={formatDateTime(value)} className={className} suppressHydrationWarning>
      {text}
    </time>
  );
}

/** Absolute timestamp formatted in the viewer's timezone after hydration. */
export function DateTime({ value, className }: { value: string | Date | null | undefined; className?: string }) {
  const [text, setText] = React.useState(() => formatDateTime(value));
  React.useEffect(() => setText(formatDateTime(value)), [value]);
  if (!value) return <span className="text-fg-dim">never</span>;
  const iso = typeof value === "string" ? value : value.toISOString();
  return (
    <time dateTime={iso} className={className} suppressHydrationWarning>
      {text}
    </time>
  );
}
