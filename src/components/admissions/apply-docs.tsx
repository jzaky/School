"use client";

import { useRef, useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { CheckCircle2, FileText, Loader2, Trash2, Upload, XCircle } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Pill } from "@/components/app/badges";
import { removeDocumentAction } from "@/server/admissions/apply-actions";
import { formatBytes } from "./ui";

export type DocTypeOpt = { key: string; label: string; required: boolean };
export type DocRow = { id: string; typeKey: string; fileName: string; sizeBytes: number; status: string; createdAt: string };

const ACCEPT = ".pdf,.jpg,.jpeg,.png,.webp,.heic,.heif,application/pdf,image/jpeg,image/png,image/webp,image/heic";

/** Upload documents per type, with type and size checks on the server. Families can remove a file until it is reviewed. */
export function DocumentUploads({ slug, applicationId, docTypes, docs, editable }: { slug: string; applicationId: string; docTypes: DocTypeOpt[]; docs: DocRow[]; editable: boolean }) {
  const t = useTranslations("admissions.docs");
  const locale = useLocale();
  const router = useRouter();
  const [rows, setRows] = useState<DocRow[]>(docs);
  const [busy, setBusy] = useState<string | null>(null);
  const [, start] = useTransition();
  const inputs = useRef<Record<string, HTMLInputElement | null>>({});

  const upload = async (typeKey: string, file: File) => {
    if (file.size > 10 * 1024 * 1024) return void toast.error(t("errors.TOO_LARGE"));
    setBusy(typeKey);
    try {
      const fd = new FormData();
      fd.set("applicationId", applicationId);
      fd.set("typeKey", typeKey);
      fd.set("file", file);
      const res = await fetch(`/api/admissions/apply/${slug}/upload`, { method: "POST", body: fd });
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; doc?: DocRow };
      if (!res.ok || !body.doc) return void toast.error(t.has(`errors.${body.error}`) ? t(`errors.${body.error}`) : t("errors.generic"));
      setRows((r) => [...r, body.doc!]);
      toast.success(t("uploaded"));
      router.refresh();
    } finally {
      setBusy(null);
      const el = inputs.current[typeKey];
      if (el) el.value = "";
    }
  };
  const remove = (d: DocRow) =>
    start(async () => {
      const r = await removeDocumentAction({ slug, locale, applicationId, documentId: d.id });
      if (!r.ok) return void toast.error(t("errors.generic"));
      setRows((x) => x.filter((y) => y.id !== d.id));
      router.refresh();
    });

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">{t("rules")}</p>
      <ul className="space-y-2">
        {docTypes.map((d) => {
          const files = rows.filter((r) => r.typeKey === d.key);
          const ok = files.some((f) => f.status !== "REJECTED");
          return (
            <li key={d.key} className="rounded-xl border bg-card p-3" data-testid={`doc-${d.key}`}>
              <div className="flex flex-wrap items-center gap-2">
                {ok ? <CheckCircle2 className="size-4 shrink-0 text-success" /> : <FileText className="size-4 shrink-0 text-muted-foreground" />}
                <span className="min-w-0 flex-1 text-sm font-medium">{d.label}</span>
                {d.required ? <Pill tone={ok ? "success" : "warning"}>{t(ok ? "received" : "required")}</Pill> : <Pill>{t("optional")}</Pill>}
              </div>
              {files.length > 0 && (
                <ul className="mt-2 space-y-1">
                  {files.map((f) => (
                    <li key={f.id} className="flex items-center gap-2 text-xs">
                      <a href={`/api/admissions/doc/${f.id}?slug=${slug}`} className="min-w-0 flex-1 truncate text-brand hover:underline" dir="ltr">
                        {f.fileName}
                      </a>
                      <span className="shrink-0 text-muted-foreground">{formatBytes(f.sizeBytes, locale)}</span>
                      {f.status === "ACCEPTED" && <Pill tone="success">{t("status.ACCEPTED")}</Pill>}
                      {f.status === "REJECTED" && (
                        <Pill tone="danger">
                          <XCircle className="size-3" />
                          {t("status.REJECTED")}
                        </Pill>
                      )}
                      {editable && f.status === "RECEIVED" && (
                        <Button type="button" variant="ghost" size="icon" className="size-7" onClick={() => remove(f)} aria-label={t("remove")}>
                          <Trash2 className="size-3.5" />
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              {editable && (
                <div className="mt-2">
                  <input
                    ref={(el) => {
                      inputs.current[d.key] = el;
                    }}
                    type="file"
                    accept={ACCEPT}
                    className="sr-only"
                    id={`file-${d.key}`}
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) void upload(d.key, f);
                    }}
                    data-testid={`file-${d.key}`}
                  />
                  <Button type="button" variant="outline" size="sm" disabled={busy !== null} onClick={() => inputs.current[d.key]?.click()}>
                    {busy === d.key ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
                    {files.length ? t("uploadAnother") : t("upload")}
                  </Button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
