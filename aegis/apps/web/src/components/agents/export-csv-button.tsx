"use client";
import * as React from "react";
import { Download } from "lucide-react";
import { toast } from "sonner";
import { exportAgentsCsvAction } from "@/server/actions/agents";
import { Button } from "@/components/ui/button";

export function ExportCsvButton({ filter, disabled }: { filter: Record<string, string>; disabled?: boolean }) {
  const [pending, setPending] = React.useState(false);
  async function run() {
    setPending(true);
    const r = await exportAgentsCsvAction(filter);
    setPending(false);
    if (!r.ok) return toast.error(r.error);
    const blob = new Blob([r.data.csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `agents-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(`Exported ${r.data.count} of ${r.data.total} agents`);
  }
  return (
    <Button onClick={run} loading={pending} disabled={disabled} disabledReason="There are no agents in this list to export">
      <Download className="h-3.5 w-3.5" aria-hidden />
      Export CSV
    </Button>
  );
}
