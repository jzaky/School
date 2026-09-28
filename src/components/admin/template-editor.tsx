"use client";

import { useRef, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Eye, Loader2, Save } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { saveTemplateAction, type TemplateInput } from "@/server/admin/template-actions";

export function TemplateEditor({ initial, fields }: { initial: TemplateInput; fields: Array<{ key: string; label: string }> }) {
  const t = useTranslations("adminTemplates");
  const router = useRouter();
  const [v, setV] = useState<TemplateInput>(initial);
  const [active, setActive] = useState<"bodyEn" | "bodyAr">("bodyEn");
  const [pending, start] = useTransition();
  const [previewing, setPreviewing] = useState(false);
  const refs = { bodyEn: useRef<HTMLTextAreaElement>(null), bodyAr: useRef<HTMLTextAreaElement>(null) };
  const set = <K extends keyof TemplateInput>(k: K, val: TemplateInput[K]) => setV((s) => ({ ...s, [k]: val }));

  const insert = (key: string) => {
    const el = refs[active].current;
    const token = `{{${key}}}`;
    const cur = v[active];
    let pos = el ? el.selectionStart : cur.length;
    let end = el ? el.selectionEnd : pos;
    // Never drop a field inside an existing {{...}}: move the cursor past it.
    const open = cur.lastIndexOf("{{", pos);
    const close = cur.lastIndexOf("}}", pos - 1);
    if (open !== -1 && open > close) {
      const after = cur.indexOf("}}", pos);
      if (after !== -1) pos = end = after + 2;
    }
    const next = cur.slice(0, pos) + token + cur.slice(end);
    set(active, next);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(pos + token.length, pos + token.length);
    });
  };

  const preview = async () => {
    setPreviewing(true);
    const win = window.open("", "_blank");
    try {
      const res = await fetch("/api/admin/templates/preview", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(v) });
      if (!res.ok) throw new Error("preview");
      const url = URL.createObjectURL(await res.blob());
      if (win) win.location.href = url;
      else window.location.href = url;
    } catch {
      win?.close();
      toast.error(t("previewError"));
    } finally {
      setPreviewing(false);
    }
  };

  const save = () =>
    start(async () => {
      const res = await saveTemplateAction(v);
      if (res.ok) {
        toast.success(t("saved"));
        if (!v.id) router.replace(`/admin/templates/${res.id}`);
        else router.refresh();
      } else if (res.error === "FIELDS" && "fields" in res) toast.error(t("error.FIELDS", { fields: (res.fields ?? []).join(", ") }));
      else toast.error(t.has(`error.${res.error}`) ? t(`error.${res.error}`) : t("error.generic"));
    });

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_280px]">
      <div className="space-y-5">
        <div className="grid gap-4 rounded-xl border bg-card p-5 shadow-xs sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="t-name-en">{t("nameEn")}</Label>
            <Input id="t-name-en" dir="ltr" value={v.nameEn} onChange={(e) => set("nameEn", e.target.value)} data-testid="template-name-en" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="t-name-ar">{t("nameAr")}</Label>
            <Input id="t-name-ar" dir="rtl" value={v.nameAr} onChange={(e) => set("nameAr", e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="t-desc-en">{t("descEn")}</Label>
            <Input id="t-desc-en" dir="ltr" value={v.descEn ?? ""} onChange={(e) => set("descEn", e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="t-desc-ar">{t("descAr")}</Label>
            <Input id="t-desc-ar" dir="rtl" value={v.descAr ?? ""} onChange={(e) => set("descAr", e.target.value)} />
          </div>
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          {(["bodyEn", "bodyAr"] as const).map((k) => (
            <div key={k} className={cn("space-y-1.5 rounded-xl border bg-card p-4 shadow-xs transition", active === k && "border-brand/40 ring-2 ring-brand/10")}>
              <Label htmlFor={`t-${k}`}>{k === "bodyEn" ? t("bodyEn") : t("bodyAr")}</Label>
              <Textarea
                id={`t-${k}`}
                ref={refs[k]}
                dir={k === "bodyEn" ? "ltr" : "rtl"}
                rows={14}
                value={v[k]}
                onFocus={() => setActive(k)}
                onChange={(e) => set(k, e.target.value)}
                className="font-mono text-[13px] leading-relaxed"
                data-testid={`template-${k}`}
              />
            </div>
          ))}
        </div>
        <div className="grid gap-4 rounded-xl border bg-card p-5 shadow-xs sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label htmlFor="t-sig-en">{t("signatoryEn")}</Label>
            <Input id="t-sig-en" dir="ltr" value={v.signatoryEn ?? ""} onChange={(e) => set("signatoryEn", e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="t-sig-ar">{t("signatoryAr")}</Label>
            <Input id="t-sig-ar" dir="rtl" value={v.signatoryAr ?? ""} onChange={(e) => set("signatoryAr", e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>{t("output")}</Label>
            <Select value={v.output} onValueChange={(o) => set("output", o as TemplateInput["output"])}>
              <SelectTrigger className="w-full">
                <SelectValue>{t(`outputs.${v.output}`)}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {(["BILINGUAL", "EN", "AR"] as const).map((o) => (
                  <SelectItem key={o} value={o}>
                    {t(`outputs.${o}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="outline" onClick={preview} disabled={previewing} data-testid="template-preview">
            {previewing ? <Loader2 className="size-4 animate-spin" /> : <Eye className="size-4" />}
            {t("preview")}
          </Button>
          <Button onClick={save} disabled={pending} data-testid="template-save">
            {pending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
            {t("save")}
          </Button>
        </div>
      </div>
      <aside className="h-fit space-y-3 rounded-xl border bg-card p-4 shadow-xs lg:sticky lg:top-20">
        <p className="text-sm font-semibold">{t("fields")}</p>
        <p className="text-xs text-muted-foreground">{t("fieldsHint", { target: active === "bodyEn" ? t("bodyEn") : t("bodyAr") })}</p>
        <ul className="space-y-1">
          {fields.map((f) => (
            <li key={f.key}>
              <button type="button" onClick={() => insert(f.key)} className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-start text-sm hover:bg-muted" data-testid={`field-${f.key}`}>
                <span className="truncate">{f.label}</span>
                <code className="shrink-0 text-[10px] text-muted-foreground" dir="ltr">
                  {f.key}
                </code>
              </button>
            </li>
          ))}
        </ul>
      </aside>
    </div>
  );
}
