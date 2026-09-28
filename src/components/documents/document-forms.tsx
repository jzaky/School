"use client";

import { useRef, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { FileUp, Loader2, Upload } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { PickerCombobox, type PickerOption } from "@/components/forms/picker-combobox";
import { addVersionAction, createDocumentAction, setFamilyVisibilityAction } from "@/server/documents/actions";

type FileRef = { key: string; name: string; size: number; type: string };
const ACCEPT = ".pdf,.png,.jpg,.jpeg,.webp,.doc,.docx,.csv";

async function uploadFile(file: File): Promise<FileRef | { error: string }> {
  const body = new FormData();
  body.append("file", file);
  const res = await fetch("/api/uploads", { method: "POST", body });
  const json = await res.json().catch(() => ({ error: "generic" }));
  if (!res.ok) return { error: json.error ?? "generic" };
  return json as FileRef;
}

function useErr() {
  const t = useTranslations("documents");
  return (code?: string) => (code && t.has(`error.${code}`) ? t(`error.${code}`) : t("error.generic"));
}

export function UploadDocument({
  categories,
  students,
  defaultStudentId,
  caseId,
  caseLabel,
  canShare,
}: {
  categories: Array<{ id: string; label: string; sensitive: boolean }>;
  students: PickerOption[];
  defaultStudentId?: string;
  caseId?: string;
  caseLabel?: string;
  canShare: boolean;
}) {
  const t = useTranslations("documents");
  const err = useErr();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [file, setFile] = useState<File | null>(null);
  const [titleEn, setTitleEn] = useState("");
  const [titleAr, setTitleAr] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [studentId, setStudentId] = useState(defaultStudentId ?? "");
  const [share, setShare] = useState(false);
  const [expiresAt, setExpiresAt] = useState("");
  const category = categories.find((c) => c.id === categoryId);
  const shareBlocked = !!caseId || !!category?.sensitive || !studentId;

  const reset = () => {
    setFile(null);
    setTitleEn("");
    setTitleAr("");
    setCategoryId("");
    setShare(false);
    setExpiresAt("");
  };

  const submit = () =>
    start(async () => {
      if (!file) return;
      const up = await uploadFile(file);
      if ("error" in up) return void toast.error(err(up.error));
      const res = await createDocumentAction({ file: up, titleEn, titleAr, categoryId: categoryId || null, studentId: studentId || null, caseId, visibleToFamily: share && !shareBlocked, expiresAt: expiresAt || null });
      if (!res.ok) return void toast.error(err(res.error));
      toast.success(t("uploaded"));
      setOpen(false);
      reset();
      router.refresh();
    });

  return (
    <>
      <Button onClick={() => setOpen(true)} data-testid="upload-document">
        <Upload className="size-4" />
        {t("upload")}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("uploadTitle")}</DialogTitle>
            <DialogDescription>{caseLabel ? t("uploadToCase", { case: caseLabel }) : t("uploadBody")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <label className="flex cursor-pointer flex-col items-center gap-2 rounded-xl border border-dashed bg-muted/30 p-5 text-center text-sm hover:bg-muted/50">
              <FileUp className="size-6 text-muted-foreground" />
              <span className="font-medium">{file ? file.name : t("chooseFile")}</span>
              <span className="text-xs text-muted-foreground">{t("fileHint")}</span>
              <input
                type="file"
                accept={ACCEPT}
                className="sr-only"
                data-testid="document-file"
                onChange={(e) => {
                  const f = e.target.files?.[0] ?? null;
                  setFile(f);
                  if (f && !titleEn) setTitleEn(f.name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " "));
                }}
              />
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="doc-title-en">{t("titleEn")}</Label>
                <Input id="doc-title-en" value={titleEn} onChange={(e) => setTitleEn(e.target.value)} dir="ltr" data-testid="document-title" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="doc-title-ar">{t("titleAr")}</Label>
                <Input id="doc-title-ar" value={titleAr} onChange={(e) => setTitleAr(e.target.value)} dir="rtl" placeholder={t("optional")} />
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>{t("category")}</Label>
                <Select value={categoryId} onValueChange={setCategoryId}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder={t("chooseCategory")}>{category?.label}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {categories.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="doc-expires">{t("expires")}</Label>
                <Input id="doc-expires" type="date" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} />
              </div>
            </div>
            {!caseId && (
              <div className="space-y-1.5">
                <Label>{t("student")}</Label>
                <PickerCombobox options={students} value={studentId} onChange={setStudentId} placeholder={t("chooseStudent")} testId="document-student" />
              </div>
            )}
            {canShare && (
              <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
                <div>
                  <p className="text-sm font-medium">{t("shareFamily")}</p>
                  <p className="text-xs text-muted-foreground">{shareBlocked ? t("shareBlocked") : t("shareHint")}</p>
                </div>
                <Switch checked={share && !shareBlocked} onCheckedChange={setShare} disabled={shareBlocked} aria-label={t("shareFamily")} />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              {t("cancel")}
            </Button>
            <Button onClick={submit} disabled={pending || !file || !titleEn.trim()} data-testid="document-save">
              {pending && <Loader2 className="size-4 animate-spin" />}
              {t("save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function NewVersionButton({ documentId }: { documentId: string }) {
  const t = useTranslations("documents");
  const err = useErr();
  const router = useRouter();
  const ref = useRef<HTMLInputElement>(null);
  const [pending, start] = useTransition();
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button type="button" onClick={() => ref.current?.click()} disabled={pending} aria-label={t("newVersion")} className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground">
          {pending ? <Loader2 className="size-4 animate-spin" /> : <FileUp className="size-4" />}
          <input
            ref={ref}
            type="file"
            accept={ACCEPT}
            className="sr-only"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              start(async () => {
                const up = await uploadFile(f);
                if ("error" in up) return void toast.error(err(up.error));
                const res = await addVersionAction({ documentId, file: up });
                if (!res.ok) return void toast.error(err(res.error));
                toast.success(t("versionAdded", { version: res.version }));
                router.refresh();
              });
              e.target.value = "";
            }}
          />
        </button>
      </TooltipTrigger>
      <TooltipContent>{t("newVersion")}</TooltipContent>
    </Tooltip>
  );
}

export function FamilyToggle({ documentId, visible, blocked }: { documentId: string; visible: boolean; blocked: boolean }) {
  const t = useTranslations("documents");
  const err = useErr();
  const router = useRouter();
  const [pending, start] = useTransition();
  const control = (
    <Switch
      checked={visible}
      disabled={pending || (blocked && !visible)}
      aria-label={t("shareFamily")}
      onCheckedChange={(v) =>
        start(async () => {
          const res = await setFamilyVisibilityAction({ documentId, visible: v });
          if (!res.ok) return void toast.error(err(res.error));
          toast.success(v ? t("sharedOn") : t("sharedOff"));
          router.refresh();
        })
      }
    />
  );
  if (!blocked || visible) return control;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span>{control}</span>
      </TooltipTrigger>
      <TooltipContent>{t("shareBlocked")}</TooltipContent>
    </Tooltip>
  );
}
