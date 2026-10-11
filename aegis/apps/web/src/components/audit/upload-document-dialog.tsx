"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Upload } from "lucide-react";
import { uploadDocumentAction, type UploadResult } from "@/server/actions/audit";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, FormError, Input } from "@/components/ui/input";
import { Note } from "@/components/ui/note";
import { formatBytes } from "./format";

const ACCEPT = ".pdf,.docx,.txt,.md,.markdown,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,text/markdown";
const MAX_BYTES = 25 * 1024 * 1024;

export function UploadDocumentDialog({ canWrite }: { canWrite: boolean }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [file, setFile] = React.useState<File | null>(null);
  const [title, setTitle] = React.useState("");
  const [titleTouched, setTitleTouched] = React.useState(false);
  const [retention, setRetention] = React.useState("");
  const [result, setResult] = React.useState<UploadResult | null>(null);

  React.useEffect(() => {
    if (file && !titleTouched) setTitle(file.name.replace(/\.[^.]+$/, ""));
  }, [file, titleTouched]);

  const tooLarge = !!file && file.size > MAX_BYTES;
  const canSubmit = !!file && !tooLarge && title.trim().length > 0 && !pending;

  function reset() {
    setFile(null);
    setTitle("");
    setTitleTouched(false);
    setRetention("");
    setError(null);
    setResult(null);
  }

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!canSubmit) return;
    const fd = new FormData(e.currentTarget);
    fd.set("title", title.trim());
    setPending(true);
    setError(null);
    const r = await uploadDocumentAction(fd);
    setPending(false);
    if (!r.ok) return setError(r.error);
    setResult(r.data);
    if (r.data.status === "parsed") toast.success(`${r.data.title} parsed into ${r.data.chunkCount} chunks`);
    else toast.error(`${r.data.title} could not be parsed`);
    router.refresh();
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) reset();
      }}
      trigger={
        <Button variant="primary" disabled={!canWrite} disabledReason="Requires audit:write">
          <Upload className="h-3.5 w-3.5" aria-hidden />
          Upload document
        </Button>
      }
      title="Upload a document"
      description="PDF, DOCX, TXT or Markdown up to 25 MB. The file is parsed and chunked in this deployment; its content never leaves it."
      footer={
        result ? (
          <Button variant="primary" onClick={() => setOpen(false)}>
            Done
          </Button>
        ) : (
          <>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button form="upload-document-form" type="submit" variant="primary" loading={pending} disabled={!canSubmit} disabledReason={!file ? "Choose a file" : tooLarge ? "File exceeds the 25 MB limit" : title.trim().length === 0 ? "Title is required" : undefined}>
              {pending ? "Uploading and parsing" : "Upload and parse"}
            </Button>
          </>
        )
      }
    >
      {result ? (
        <div className="space-y-3" aria-live="polite" data-testid="upload-result">
          {result.status === "parsed" ? (
            <Note>
              <strong>{result.title}</strong> parsed: {result.chunkCount} chunks{result.pageCount ? `, ${result.pageCount} pages` : ""}. It can now be selected as evidence in an assessment.
            </Note>
          ) : (
            <Note tone="danger">
              <strong>{result.title}</strong> was stored but parsing failed: {result.error ?? "unknown error"}. Delete it and upload a readable file.
            </Note>
          )}
        </div>
      ) : (
        <form id="upload-document-form" onSubmit={submit} className="space-y-3">
          <Field label="File" htmlFor="doc-file" hint="pdf, docx, txt, md">
            <input id="doc-file" name="file" type="file" accept={ACCEPT} required onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="block w-full text-sm text-fg file:me-3 file:rounded-md file:border file:border-line-strong file:bg-bg-elev file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-fg hover:file:bg-bg-elev-2" />
            {file ? (
              <p className={`mt-1 text-xs ${tooLarge ? "text-deny" : "text-fg-muted"}`}>
                {file.name}, {formatBytes(file.size)}
                {tooLarge ? " exceeds the 25 MB limit" : ""}
              </p>
            ) : null}
          </Field>
          <Field label="Title" htmlFor="doc-title">
            <Input
              id="doc-title"
              value={title}
              onChange={(e) => {
                setTitleTouched(true);
                setTitle(e.target.value);
              }}
              maxLength={200}
              required
            />
          </Field>
          <Field label="Retention" htmlFor="doc-retention" hint="days, optional; the file is deleted when it expires">
            <Input id="doc-retention" name="retentionDays" type="number" min={1} max={3650} value={retention} onChange={(e) => setRetention(e.target.value)} placeholder="keep indefinitely" className="w-48" />
          </Field>
          <FormError error={error} />
        </form>
      )}
    </Dialog>
  );
}
