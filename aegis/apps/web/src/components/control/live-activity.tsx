"use client";
import * as React from "react";
import Link from "next/link";
import { ArrowUpRight, Pause, Play, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { activityFeedAction, type ActivityEvent } from "@/server/actions/gateway";
import type { ActivityFamily } from "@/server/queries/control";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { TimeAgo } from "@/components/ui/time";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/utils";
import { TONE_DOT, type Tone } from "@/lib/status";

const FAMILIES: { id: ActivityFamily; label: string; tone: Tone }[] = [
  { id: "gateway", label: "Gateway", tone: "info" },
  { id: "approval", label: "Approval", tone: "approval" },
  { id: "policy", label: "Policy", tone: "allow" },
  { id: "agent", label: "Agent", tone: "neutral" },
  { id: "monitoring", label: "Monitoring", tone: "critical" },
  { id: "security", label: "Security", tone: "deny" },
];
const FAMILY_TONE = Object.fromEntries(FAMILIES.map((f) => [f.id, f.tone])) as Record<ActivityFamily, Tone>;

function typeTone(type: string, family: ActivityFamily): Tone {
  if (/denied|failed|rejected|revoked|suspended|expired|disabled|mismatch|conflict|blocked/.test(type)) return "deny";
  if (/allow|executed|approved|granted|activated|created|enabled|verified|resumed/.test(type)) return "allow";
  if (/require|pending|requested|more_info|escalat|paused/.test(type)) return "approval";
  return FAMILY_TONE[family];
}

const POLL_MS = 5000;
const MAX_ROWS = 300;

export function LiveActivity({ initial }: { initial: ActivityEvent[] }) {
  const [events, setEvents] = React.useState<ActivityEvent[]>(initial);
  const [paused, setPaused] = React.useState(false);
  const [families, setFamilies] = React.useState<Set<ActivityFamily>>(new Set(FAMILIES.map((f) => f.id)));
  const [fresh, setFresh] = React.useState<Set<string>>(new Set());
  const [lastPoll, setLastPoll] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const lastSeq = React.useRef<string | null>(initial[0]?.seq ?? null);
  const inflight = React.useRef(false);

  const poll = React.useCallback(async () => {
    if (inflight.current) return;
    inflight.current = true;
    try {
      const r = await activityFeedAction({ afterSeq: lastSeq.current, limit: 100 });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setError(null);
      setLastPoll(r.data.serverTime);
      if (r.data.events.length) {
        lastSeq.current = r.data.events[0]!.seq;
        setFresh(new Set(r.data.events.map((e) => e.id)));
        setEvents((prev) => [...r.data.events, ...prev].slice(0, MAX_ROWS));
        setTimeout(() => setFresh(new Set()), 1500);
      }
    } finally {
      inflight.current = false;
    }
  }, []);

  React.useEffect(() => {
    if (paused) return;
    const t = setInterval(poll, POLL_MS);
    return () => clearInterval(t);
  }, [paused, poll]);

  function toggleFamily(id: ActivityFamily) {
    setFamilies((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      if (next.size === 0) return new Set(FAMILIES.map((f) => f.id));
      return next;
    });
  }
  const visible = events.filter((e) => families.has(e.family));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div role="group" aria-label="Event families" className="flex flex-wrap gap-1">
          {FAMILIES.map((f) => {
            const on = families.has(f.id);
            const n = events.filter((e) => e.family === f.id).length;
            return (
              <button key={f.id} type="button" aria-pressed={on} onClick={() => toggleFamily(f.id)} className={cn("inline-flex h-7 items-center gap-1.5 rounded-md border px-2 text-xs transition-colors duration-150", on ? "border-line-strong bg-bg-elev text-fg" : "border-transparent bg-transparent text-fg-dim hover:text-fg-muted")}>
                <span className={cn("h-1.5 w-1.5 rounded-full", on ? TONE_DOT[f.tone] : "bg-fg-dim/50")} aria-hidden />
                {f.label}
                <span className="tabular text-fg-dim">{n}</span>
              </button>
            );
          })}
        </div>
        <div className="ms-auto flex items-center gap-2 text-xs text-fg-muted">
          <span className="inline-flex items-center gap-1.5" aria-live="polite">
            <span className={cn("h-2 w-2 rounded-full", paused ? "bg-fg-dim" : "bg-allow")} aria-hidden />
            {paused ? "Paused" : "Live, every 5 seconds"}
            {lastPoll ? (
              <span className="text-fg-dim">
                (checked <TimeAgo value={lastPoll} />)
              </span>
            ) : null}
          </span>
          <Button size="sm" variant="ghost" onClick={() => void poll()} aria-label="Refresh now">
            <RefreshCw className="h-3.5 w-3.5" aria-hidden />
            Refresh
          </Button>
          <Button size="sm" onClick={() => setPaused((p) => !p)} aria-pressed={paused}>
            {paused ? <Play className="h-3.5 w-3.5" aria-hidden /> : <Pause className="h-3.5 w-3.5" aria-hidden />}
            {paused ? "Resume" : "Pause"}
          </Button>
        </div>
      </div>
      {error ? <p className="text-xs text-deny">Feed error: {error}</p> : null}
      <div className="overflow-hidden rounded-panel border border-line bg-bg-elev">
        {visible.length === 0 ? (
          <EmptyState title="No events for the selected families" description="Events appear here within five seconds of being written to the evidence ledger." />
        ) : (
          <ul className="divide-y divide-line" aria-live="off">
            {visible.map((e) => (
              <li key={e.id} className={cn("flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-[13px] transition-colors duration-500", fresh.has(e.id) && "bg-accent/10")} data-seq={e.seq}>
                <span className="w-16 shrink-0 font-mono text-[11px] tabular text-fg-dim">#{e.seq}</span>
                <Badge tone={FAMILY_TONE[e.family]}>{e.family}</Badge>
                <Badge tone={typeTone(e.type, e.family)} mono>
                  {e.type}
                </Badge>
                <span className="text-fg">{e.actor}</span>
                {e.href ? (
                  <Link href={e.href} className="inline-flex items-center gap-0.5 text-accent hover:underline">
                    {e.subjectLabel ?? e.subjectType.replace(/_/g, " ")}
                    {e.subjectId && !e.subjectLabel ? <span className="font-mono text-[11px]"> {e.subjectId.slice(0, 8)}</span> : null}
                    <ArrowUpRight className="h-3 w-3" aria-hidden />
                  </Link>
                ) : (
                  <span className="text-fg-muted">
                    {e.subjectLabel ?? e.subjectType.replace(/_/g, " ")}
                    {e.subjectId ? <span className="font-mono text-[11px]"> {e.subjectId.slice(0, 8)}</span> : null}
                  </span>
                )}
                <span className="min-w-0 flex-1 truncate text-xs text-fg-muted" title={e.summary}>
                  {e.summary}
                </span>
                <span className="shrink-0 text-xs text-fg-dim">
                  <TimeAgo value={e.occurredAt} />
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <p className="text-[11px] text-fg-dim">
        Showing the latest {visible.length} of {events.length} loaded events. Older history is in the{" "}
        <Link href="/evidence" className="text-accent hover:underline" onClick={() => toast.dismiss()}>
          Evidence Ledger
        </Link>
        .
      </p>
    </div>
  );
}
