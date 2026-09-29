import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";

/** Link tabs: the state lives in the URL so views can be shared and reloaded. */
export function AccessTabs({ current, tabs, label }: { current: string; label?: string; tabs: Array<{ value: string; label: string; href: string; count?: number }> }) {
  return (
    <nav className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0" aria-label={label}>
      <div className="inline-flex min-w-full gap-1 border-b sm:min-w-0">
        {tabs.map((tab) => (
          <Link
            key={tab.value}
            href={tab.href}
            data-testid={`tab-${tab.value}`}
            aria-current={tab.value === current ? "page" : undefined}
            className={cn(
              "-mb-px flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition",
              tab.value === current ? "border-brand text-brand" : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {tab.label}
            {typeof tab.count === "number" && tab.count > 0 && <span className="rounded-full bg-muted px-1.5 text-xs tabular-nums text-muted-foreground">{tab.count}</span>}
          </Link>
        ))}
      </div>
    </nav>
  );
}
