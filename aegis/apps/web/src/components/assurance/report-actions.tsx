"use client";
import * as React from "react";
import { useRouter, usePathname } from "next/navigation";
import { toast } from "sonner";
import { Download, Printer } from "lucide-react";
import { downloadReportAction } from "@/server/actions/assurance";
import { Button } from "@/components/ui/button";
import { downloadText } from "@/components/ui/download";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

export function PeriodSelector({ days }: { days: number }) {
  const router = useRouter();
  const pathname = usePathname();
  return (
    <Tabs value={String(days)} onValueChange={(v) => router.push(`${pathname}?days=${v}`)}>
      <TabsList aria-label="Report period" className="mb-0 border-b-0">
        {[7, 30, 90].map((d) => (
          <TabsTrigger key={d} value={String(d)}>
            {d} days
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
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
