"use client";

import { useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { joinGroupAction, previewGroupCodeAction } from "@/server/groups/actions";

/** School side of the agreement: enter a code from the group, check the group's name, then join. */
export function JoinGroupForm() {
  const t = useTranslations("groups.join");
  const tg = useTranslations("groups");
  const locale = useLocale();
  const router = useRouter();
  const [code, setCode] = useState("");
  const [preview, setPreview] = useState<{ name: string } | null>(null);
  const [pending, start] = useTransition();
  const err = (e: string) => toast.error(tg.has(`error.${e}`) ? tg(`error.${e}`) : tg("error.generic"));

  const check = () =>
    start(async () => {
      const res = await previewGroupCodeAction(code);
      if (!res.ok) return void err(res.error);
      setPreview({ name: locale === "ar" ? res.nameAr : res.nameEn });
    });
  const join = () =>
    start(async () => {
      const res = await joinGroupAction(code);
      if (!res.ok) return void err(res.error);
      toast.success(t("joined"));
      setPreview(null);
      router.refresh();
    });

  if (preview) {
    return (
      <div className="space-y-3 rounded-lg border bg-muted/30 p-4" data-testid="join-group-preview">
        <p className="text-sm">{t("confirmBody", { group: preview.name })}</p>
        <ul className="list-inside list-disc space-y-1 text-xs text-muted-foreground">
          <li>{t("sees")}</li>
          <li>{t("neverSees")}</li>
          <li>{t("templates")}</li>
        </ul>
        <div className="flex flex-wrap gap-2">
          <Button onClick={join} disabled={pending} data-testid="join-group-confirm">
            {pending && <Loader2 className="size-4 animate-spin" />}
            {t("confirm", { group: preview.name })}
          </Button>
          <Button variant="outline" onClick={() => setPreview(null)} disabled={pending}>
            {tg("cancel")}
          </Button>
        </div>
      </div>
    );
  }
  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        check();
      }}
    >
      <div className="min-w-0 flex-1 space-y-1.5">
        <Label htmlFor="group-code">{t("codeLabel")}</Label>
        <Input id="group-code" dir="ltr" autoComplete="off" placeholder="XXXXX-XXXXX" value={code} onChange={(e) => setCode(e.target.value)} className="font-mono uppercase tracking-wider" data-testid="join-group-code" />
      </div>
      <Button type="submit" variant="outline" disabled={pending || code.replace(/[\s-]/g, "").length < 10} data-testid="join-group-check">
        {pending && <Loader2 className="size-4 animate-spin" />}
        {t("check")}
      </Button>
    </form>
  );
}
