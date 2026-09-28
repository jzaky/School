import { cn } from "@/lib/utils";

/** The standard surface: white card with a hairline border. */
export function Panel({ children, className, padded = true }: { children: React.ReactNode; className?: string; padded?: boolean }) {
  return <section className={cn("rounded-xl border bg-card shadow-xs", padded && "p-5", className)}>{children}</section>;
}

export function PanelHeader({ title, description, action, icon }: { title: React.ReactNode; description?: React.ReactNode; action?: React.ReactNode; icon?: React.ReactNode }) {
  return (
    <div className="mb-4 flex items-start justify-between gap-3">
      <div className="flex min-w-0 items-start gap-2.5">
        {icon && <div className="mt-0.5 text-muted-foreground">{icon}</div>}
        <div className="min-w-0">
          <h2 className="text-sm font-semibold">{title}</h2>
          {description && <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>}
        </div>
      </div>
      {action}
    </div>
  );
}
