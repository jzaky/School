"use client";
import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { toast } from "sonner";
import { Download, Printer } from "lucide-react";
import { downloadReportAction } from "@/server/actions/assurance";
import { Button } from "@/components/ui/button";
import { downloadText } from "@/components/ui/download";
import { cn } from "@/lib/utils";

/** Period choice as plain links: the report is a server page keyed by ?days, so a link is the reliable way to change it (works before hydration too). */
export function PeriodSelector({ days }: { days: number }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Report period" className="flex flex-wrap gap-1">
      {[7, 30, 90].map((d) => {
        const active = d === days;
        return (
          <Link key={d} href={`${pathname}?days=${d}`} prefetch={false} aria-current={active ? "page" : undefined} className={cn("inline-flex h-9 items-center border-b-2 px-3 text-sm transition-colors duration-150 hover:text-fg focus-visible:bg-bg-elev-2", active ? "border-accent text-fg" : "border-transparent text-fg-muted")}>
            {d} days
          </Link>
        );
      })}
    </nav>
  );
}

export function ReportActions({ days }: { days: number }) {
  const [pending, setPending] = React.useState(false);
  async function download() {
    setPending(true);
    const r = await downloadReportAction(days);
    setPending(false);
    if (!r.ok) return toast.error(r.error);
    downloadText(r.data.filename, r.data.body, "application/json");
    toast.success("Report downloaded; generation recorded in evidence");
  }
  return (
    <>
      <Button onClick={download} loading={pending}>
        <Download className="h-3.5 w-3.5" aria-hidden />
        Download JSON
      </Button>
      <Button variant="primary" onClick={() => window.print()}>
        <Printer className="h-3.5 w-3.5" aria-hidden />
        Print / Save as PDF
      </Button>
    </>
  );
}
