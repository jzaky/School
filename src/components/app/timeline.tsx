import { Check, CircleDot, Clock, FileText, Flag, Mail, MessageSquare, Stamp, UserPlus, X, Sparkles, CalendarCheck, FolderOpen, Hourglass } from "lucide-react";
import { cn } from "@/lib/utils";

export type TimelineItem = {
  id: string;
  kind: string;
  title: string;
  body?: string | null;
  when: string;
  whenTitle?: string;
  actor?: string | null;
};

const ICONS: Record<string, { icon: React.ComponentType<{ className?: string }>; tone: string }> = {
  submitted: { icon: Flag, tone: "bg-info-soft text-info" },
  approved: { icon: Check, tone: "bg-success-soft text-success" },
  completed: { icon: Check, tone: "bg-success text-white" },
  rejected: { icon: X, tone: "bg-danger-soft text-danger" },
  approval_requested: { icon: Stamp, tone: "bg-warning-soft text-[oklch(0.55_0.14_65)]" },
  case_opened: { icon: FolderOpen, tone: "bg-brand-soft text-brand" },
  document: { icon: FileText, tone: "bg-brand-soft text-brand" },
  notified: { icon: Mail, tone: "bg-muted text-muted-foreground" },
  message: { icon: MessageSquare, tone: "bg-muted text-muted-foreground" },
  meeting: { icon: CalendarCheck, tone: "bg-brand-soft text-brand" },
  task: { icon: UserPlus, tone: "bg-muted text-muted-foreground" },
  wait: { icon: Hourglass, tone: "bg-muted text-muted-foreground" },
  ai_brief: { icon: Sparkles, tone: "bg-violet-50 text-violet-700" },
  status: { icon: CircleDot, tone: "bg-brand-soft text-brand" },
};

export function Timeline({ items, empty }: { items: TimelineItem[]; empty?: React.ReactNode }) {
  if (!items.length) return <div className="py-6 text-center text-sm text-muted-foreground">{empty}</div>;
  return (
    <ol className="relative space-y-5">
      <span className="absolute inset-y-2 start-[15px] w-px bg-border" aria-hidden />
      {items.map((item) => {
        const meta = ICONS[item.kind] ?? (item.kind.startsWith("note") ? { icon: MessageSquare, tone: "bg-muted text-muted-foreground" } : { icon: Clock, tone: "bg-muted text-muted-foreground" });
        const Ico = meta.icon;
        return (
          <li key={item.id} className="relative flex gap-3">
            <span className={cn("relative z-10 grid size-8 shrink-0 place-items-center rounded-full ring-4 ring-card", meta.tone)}>
              <Ico className="size-4" />
            </span>
            <div className="min-w-0 flex-1 pt-1">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                <p className="text-sm font-medium">{item.title}</p>
                <time className="text-xs text-muted-foreground" title={item.whenTitle}>
                  {item.when}
                </time>
              </div>
              {item.actor && <p className="text-xs text-muted-foreground">{item.actor}</p>}
              {item.body && <p className="mt-1 whitespace-pre-line text-sm text-muted-foreground">{item.body}</p>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
