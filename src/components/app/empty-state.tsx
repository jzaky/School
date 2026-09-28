import { cn } from "@/lib/utils";

export function EmptyState({ icon, title, body, action, className }: { icon?: React.ReactNode; title: React.ReactNode; body?: React.ReactNode; action?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col items-center justify-center rounded-xl border border-dashed bg-card/50 px-6 py-12 text-center", className)}>
      {icon && <div className="mb-3 grid size-11 place-items-center rounded-full bg-muted text-muted-foreground">{icon}</div>}
      <div className="text-sm font-medium">{title}</div>
      {body && <p className="mt-1 max-w-sm text-sm text-muted-foreground">{body}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
