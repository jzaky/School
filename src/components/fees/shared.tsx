import { useTranslations } from "next-intl";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { Pill, type Tone } from "@/components/app/badges";
import { Button } from "@/components/ui/button";
import { formatAed } from "@/server/fees/money";
import type { Permission } from "@/server/identity/permissions";

/** An amount in AED from integer fils, isolated so it reads correctly in right-to-left text. */
export function Money({ fils, locale, className, signed }: { fils: number; locale: "en" | "ar"; className?: string; signed?: boolean }) {
  const text = formatAed(fils, locale);
  return (
    <bdi className={cn("tabular-nums whitespace-nowrap", className)}>
      {signed && fils > 0 ? "+" : ""}
      {text}
    </bdi>
  );
}

const INVOICE_TONE: Record<string, Tone> = { OPEN: "info", PARTIAL: "warning", PAID: "success", CREDITED: "neutral", CANCELLED: "neutral", CONVERTED: "brand", OVERDUE: "danger" };
const PAYMENT_TONE: Record<string, Tone> = { HELD: "gold", CLEARED: "success", BOUNCED: "danger" };
const REFUND_TONE: Record<string, Tone> = { REQUESTED: "warning", APPROVED: "info", REJECTED: "neutral", PAID: "success" };
const AWARD_TONE: Record<string, Tone> = { PENDING: "warning", APPROVED: "success", REJECTED: "neutral", REVOKED: "neutral" };
const RUN_TONE: Record<string, Tone> = { QUEUED: "info", RUNNING: "brand", COMPLETED: "success", FAILED: "danger", CANCELLED: "neutral" };

export function InvoiceStatus({ status, overdue, kind }: { status: string; overdue?: boolean; kind?: string }) {
  const t = useTranslations("finance.status");
  const key = overdue && (status === "OPEN" || status === "PARTIAL") ? "OVERDUE" : status;
  return (
    <Pill tone={INVOICE_TONE[key] ?? "neutral"} dot>
      {kind === "PROFORMA" && status === "OPEN" ? t("PROFORMA_OPEN") : t(`invoice.${key}`)}
    </Pill>
  );
}
export function PaymentStatus({ status }: { status: string }) {
  const t = useTranslations("finance.status");
  return <Pill tone={PAYMENT_TONE[status] ?? "neutral"} dot>{t(`payment.${status}`)}</Pill>;
}
export function RefundStatus({ status }: { status: string }) {
  const t = useTranslations("finance.status");
  return <Pill tone={REFUND_TONE[status] ?? "neutral"} dot>{t(`refund.${status}`)}</Pill>;
}
export function AwardStatus({ status }: { status: string }) {
  const t = useTranslations("finance.status");
  return <Pill tone={AWARD_TONE[status] ?? "neutral"} dot>{t(`award.${status}`)}</Pill>;
}
export function RunStatus({ status }: { status: string }) {
  const t = useTranslations("finance.status");
  return <Pill tone={RUN_TONE[status] ?? "neutral"} dot>{t(`run.${status}`)}</Pill>;
}

/** Previous and next links for a paginated list (keeps the other query parameters). */
export function Pager({ page, total, pageSize, href }: { page: number; total: number; pageSize: number; href: (page: number) => string }) {
  const t = useTranslations("finance");
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return null;
  return (
    <div className="flex items-center justify-between gap-3 border-t px-4 py-3 text-sm text-muted-foreground" data-testid="pager">
      <span className="tabular-nums">{t("pageOf", { page, pages, total })}</span>
      <div className="flex gap-2">
        {page > 1 ? (
          <Button asChild variant="outline" size="sm">
            <Link prefetch={false} href={href(page - 1)}>
              <ChevronLeft className="size-4 rtl:rotate-180" />
              {t("prev")}
            </Link>
          </Button>
        ) : (
          <Button variant="outline" size="sm" disabled>
            <ChevronLeft className="size-4 rtl:rotate-180" />
            {t("prev")}
          </Button>
        )}
        {page < pages ? (
          <Button asChild variant="outline" size="sm">
            <Link prefetch={false} href={href(page + 1)} data-testid="pager-next">
              {t("next")}
              <ChevronRight className="size-4 rtl:rotate-180" />
            </Link>
          </Button>
        ) : (
          <Button variant="outline" size="sm" disabled>
            {t("next")}
            <ChevronRight className="size-4 rtl:rotate-180" />
          </Button>
        )}
      </div>
    </div>
  );
}

/** Build a query string from the current parameters with some changed. */
export function qs(base: Record<string, string | undefined>, change: Record<string, string | number | undefined>) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...base, ...Object.fromEntries(Object.entries(change).map(([k2, v2]) => [k2, v2 === undefined ? undefined : String(v2)])) })) if (v) p.set(k, v);
  const s = p.toString();
  return s ? `?${s}` : "";
}

export const FINANCE_SECTIONS = [
  { key: "overview", href: "/finance", perm: "fees.view" },
  { key: "accounts", href: "/finance/accounts", perm: "fees.view" },
  { key: "invoices", href: "/finance/invoices", perm: "fees.view" },
  { key: "payments", href: "/finance/payments", perm: "fees.view" },
  { key: "billing", href: "/finance/billing", perm: "fees.manage" },
  { key: "approvals", href: "/finance/approvals", perm: "fees.refund.approve" },
  { key: "reports", href: "/finance/reports", perm: "fees.reports" },
  { key: "setup", href: "/finance/setup", perm: "fees.view" },
] as const;

/** The Finance area's own tabs (only the ones this person can use). */
export function FinanceTabs({ active, can }: { active: (typeof FINANCE_SECTIONS)[number]["key"]; can: (p: Permission) => boolean }) {
  const t = useTranslations("finance.tabs");
  return (
    <nav className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1" aria-label={t("label")}>
      {FINANCE_SECTIONS.filter((s) => can(s.perm)).map((s) => (
        <Link
          key={s.key}
          href={s.href}
          // Finance pages run aggregates; prefetching every section on each page load wastes database work, and
          // prefetches racing a click stalled navigation in testing.
          prefetch={false}
          data-testid={`fin-tab-${s.key}`}
          className={cn("shrink-0 rounded-md px-3 py-1.5 text-sm font-medium transition", active === s.key ? "bg-brand-soft text-brand" : "text-muted-foreground hover:bg-muted hover:text-foreground")}
          aria-current={active === s.key ? "page" : undefined}
        >
          {t(s.key)}
        </Link>
      ))}
    </nav>
  );
}
