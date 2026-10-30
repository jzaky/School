import * as React from "react";
import { cn } from "@/lib/utils";

export function Panel({ className, children, title, description, actions, padded = true, ...props }: Omit<React.HTMLAttributes<HTMLDivElement>, "title"> & { title?: React.ReactNode; description?: React.ReactNode; actions?: React.ReactNode; padded?: boolean }) {
  return (
    <section className={cn("rounded-panel border border-line bg-bg-elev", className)} {...props}>
      {title || actions ? (
        <header className={cn("flex items-start justify-between gap-3 border-b border-line px-4 py-3")}>
          <div className="min-w-0">
            {title ? <h2 className="text-sm font-semibold leading-5 text-fg">{title}</h2> : null}
            {description ? <p className="mt-0.5 text-xs text-fg-muted">{description}</p> : null}
          </div>
          {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
        </header>
      ) : null}
      <div className={cn(padded && "p-4")}>{children}</div>
    </section>
  );
}
