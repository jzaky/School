"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { FileUp } from "lucide-react";
import type { ControlInput } from "@aegis/core";
import { importControlsAction, previewControlsCsvAction } from "@/server/actions/audit";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, FormError, Textarea } from "@/components/ui/input";
import { SimpleTable, Td, Th, Tr } from "@/components/ui/simple-table";
import { Badge } from "@/components/ui/badge";

const TEMPLATE = `code,title,summary,category,keywords,automated_evidence_type
GOV-1,AI governance committee,"An accountable committee oversees AI systems and meets quarterly.",Governance,"committee;oversight;quarterly",
RISK-1,Risk assessment per system,"Each AI system has a documented risk assessment reviewed annually.",Risk,"risk assessment;annual review",approval_workflow`;

export function ImportCsvDialog({ frameworkId, custom, canWrite }: { frameworkId: string; custom: boolean; canWrite: boolean }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [csv, setCsv] = React.useState(TEMPLATE);
  const [preview, setPreview] = React.useState<ControlInput[] | null>(null);
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const reason = !custom ? "Frameworks from the shared catalog cannot be changed. Create a custom framework to import your own controls." : !canWrite ? "Requires audit:write" : undefined;

  async function runPreview() {
    setPending(true);
    setError(null);
    setPreview(null);
    const r = await previewControlsCsvAction(csv);
    setPending(false);
    if (!r.ok) return setError(r.error);
    setPreview(r.data.controls);
  }

  async function runImport() {
    setPending(true);
    setError(null);
    const r = await importControlsAction(frameworkId, csv);
    setPending(false);
    if (!r.ok) return setError(r.error);
    toast.success(`${r.data.created} created, ${r.data.updated} updated`);
    setOpen(false);
    setPreview(null);
    router.refresh();
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) {
          setPreview(null);
          setError(null);
        }
      }}
      trigger={
        <Button disabled={!!reason} disabledReason={reason}>
          <FileUp className="h-3.5 w-3.5" aria-hidden />
          Import CSV
        </Button>
      }
      title="Import controls from CSV"
      description="Paste a CSV with this header row: code,title,summary,category,keywords,automated_evidence_type. Separate keywords with ; or |. Controls whose code already exists are updated; new codes are added."
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={runPreview} loading={pending && !preview} disabled={csv.trim().length === 0 || pending} disabledReason="Paste CSV first">
            Preview
          </Button>
          <Button variant="primary" onClick={runImport} loading={pending && !!preview} disabled={!preview || preview.length === 0 || pending} disabledReason={!preview ? "Preview the CSV first" : "The preview found no controls to import"}>
            Import {preview?.length ? `${preview.length} controls` : ""}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="CSV" htmlFor="csv-text">
          <Textarea
            id="csv-text"
            value={csv}
            onChange={(e) => {
              setCsv(e.target.value);
              setPreview(null);
            }}
            rows={8}
            mono
            spellCheck={false}
          />
        </Field>
        <FormError error={error} />
        {preview ? (
          <div>
            <p className="mb-2 text-xs text-fg-muted">{preview.length} controls read from the CSV. Check them below, then import.</p>
            <SimpleTable caption="CSV preview">
              <thead>
                <tr>
                  <Th>Code</Th>
                  <Th>Title</Th>
                  <Th>Category</Th>
                  <Th>Keywords</Th>
                  <Th>Automated</Th>
                </tr>
              </thead>
              <tbody>
                {preview.map((ctl) => (
                  <Tr key={ctl.code}>
                    <Td mono>{ctl.code}</Td>
                    <Td className="max-w-[260px] truncate">{ctl.title}</Td>
                    <Td>{ctl.category || <span className="text-fg-dim">none</span>}</Td>
                    <Td className="max-w-[220px] truncate text-xs text-fg-muted">{ctl.keywords.join(", ") || <span className="text-fg-dim">none</span>}</Td>
                    <Td>{ctl.automatedEvidenceType ? <Badge tone="info" mono>{ctl.automatedEvidenceType}</Badge> : <span className="text-fg-dim">none</span>}</Td>
                  </Tr>
                ))}
              </tbody>
            </SimpleTable>
          </div>
        ) : null}
      </div>
    </Dialog>
  );
}
