"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Loader2, SlidersHorizontal } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { updateGuardianLinkAction } from "@/server/admin/people-actions";
import { usePeopleError } from "./staff-forms";

type Flags = { isPrimary: boolean; canApprove: boolean; receivesUpdates: boolean };

export function GuardianLinkDialog({ link, guardianName, studentName }: { link: Flags & { id: string }; guardianName: string; studentName: string }) {
  const t = useTranslations("adminPeople");
  const err = usePeopleError();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [flags, setFlags] = useState<Flags>(link);

  const submit = () =>
    start(async () => {
      const res = await updateGuardianLinkAction({ linkId: link.id, ...flags });
      if (!res.ok) return void toast.error(err(res.error));
      toast.success(t("linkUpdated"));
      setOpen(false);
      router.refresh();
    });

  const rows: Array<{ key: keyof Flags; label: string; hint: string }> = [
    { key: "isPrimary", label: t("flagPrimaryLabel"), hint: t("flagPrimaryHint") },
    { key: "canApprove", label: t("flagApproveLabel"), hint: t("flagApproveHint") },
    { key: "receivesUpdates", label: t("flagUpdatesLabel"), hint: t("flagUpdatesHint") },
  ];

  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={() => {
              setFlags({ isPrimary: link.isPrimary, canApprove: link.canApprove, receivesUpdates: link.receivesUpdates });
              setOpen(true);
            }}
            aria-label={t("editLink")}
            className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
            data-testid="edit-link"
          >
            <SlidersHorizontal className="size-3.5" />
          </button>
        </TooltipTrigger>
        <TooltipContent>{t("editLink")}</TooltipContent>
      </Tooltip>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("editLinkTitle")}</DialogTitle>
            <DialogDescription>{t("editLinkBody", { guardian: guardianName, student: studentName })}</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            {rows.map((r) => (
              <label key={r.key} className="flex cursor-pointer items-center justify-between gap-3 rounded-lg border p-3">
                <span>
                  <span className="block text-sm font-medium">{r.label}</span>
                  <span className="block text-xs text-muted-foreground">{r.hint}</span>
                </span>
                <Switch checked={flags[r.key]} onCheckedChange={(v) => setFlags((p) => ({ ...p, [r.key]: v }))} data-testid={`link-${r.key}`} />
              </label>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              {t("cancel")}
            </Button>
            <Button onClick={submit} disabled={pending} data-testid="link-save">
              {pending && <Loader2 className="size-4 animate-spin" />}
              {t("save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
