import { cn } from "@/lib/utils";
import { Link } from "@/i18n/navigation";

const TONES = {
  brand: "bg-brand-soft text-brand",
  success: "bg-success-soft text-success",
  warning: "bg-warning-soft text-warning",
  danger: "bg-danger-soft text-danger",
  info: "bg-info-soft text-info",
  gold: "bg-gold-soft text-[oklch(0.55_0.1_80)]",
} as const;

export function StatCard({
  label,
  value,
  hint,
  icon,
  tone = "brand",
  href,
  testId,
}: {
  label: React.ReactNode;
  value: React.ReactNode;
  hint?: React.ReactNode;
  icon?: React.ReactNode;
  tone?: keyof typeof TONES;
  href?: string;
  testId?: string;
}) {
  const body = (
    <div className={cn("flex h-full items-start gap-4 rounded-xl border bg-card p-5 shadow-xs transition", href && "hover:border-brand/25 hover:shadow-sm")} data-testid={testId}>
      {icon && <div className={cn("grid size-10 shrink-0 place-items-center rounded-lg", TONES[tone])}>{icon}</div>}
      <div className="min-w-0">
        <div className="text-xs font-medium text-muted-foreground">{label}</div>
        <div className="mt-1 text-2xl font-semibold tabular-nums tracking-tight">{value}</div>
        {hint && <div className="mt-0.5 text-xs text-muted-foreground">{hint}</div>}
      </div>
    </div>
  );
  return href ? (
    <Link href={href} className="block">
      {body}
    </Link>
  ) : (
    body
  );
}
