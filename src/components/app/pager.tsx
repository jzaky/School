import { useTranslations } from "next-intl";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { fmtNumber, type FormatPrefs } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import type { PageWindow } from "@/server/common/paging";

/**
 * "Showing 1 to 50 of 1,554" with previous and next links. The total is the real count of the filtered list.
 * `href` builds the link for a page from the current filters, so paging keeps the search and filters.
 */
export function Pager({ win, prefs, href, className }: { win: PageWindow; prefs: FormatPrefs; href: (page: number) => string; className?: string }) {
  const t = useTranslations("paging");
  const n = (x: number) => fmtNumber(prefs, x);
  return (
    <div className={cn("flex flex-col gap-2 py-2 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between", className)} data-testid="pager">
      <span className="tabular-nums" data-testid="pager-summary">
        {win.total === 0 ? t("none") : t("showing", { from: n(win.from), to: n(win.to), total: n(win.total) })}
      </span>
      {win.pages > 1 && (
        <div className="flex items-center gap-2">
          <span className="tabular-nums text-xs">{t("page", { page: n(win.page), pages: n(win.pages) })}</span>
          {win.page > 1 ? (
            <Button asChild variant="outline" size="sm">
              <Link prefetch={false} href={href(win.page - 1)} data-testid="pager-prev" rel="prev">
                <ChevronLeft className="size-4 rtl:rotate-180" />
                {t("prev")}
              </Link>
            </Button>
          ) : (
            <Button variant="outline" size="sm" disabled title={t("firstPage")}>
              <ChevronLeft className="size-4 rtl:rotate-180" />
              {t("prev")}
            </Button>
          )}
          {win.page < win.pages ? (
            <Button asChild variant="outline" size="sm">
              <Link prefetch={false} href={href(win.page + 1)} data-testid="pager-next" rel="next">
                {t("next")}
                <ChevronRight className="size-4 rtl:rotate-180" />
              </Link>
            </Button>
          ) : (
            <Button variant="outline" size="sm" disabled title={t("lastPage")}>
              {t("next")}
              <ChevronRight className="size-4 rtl:rotate-180" />
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

export { pageHref } from "@/server/common/paging";
