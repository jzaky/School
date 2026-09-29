"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Loader2, RefreshCw } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { generateTimetableAction } from "@/server/timetable/actions";
import { useTtError } from "./lesson-dialog";

export function GenerateButton({ disabledReason, hasLessons }: { disabledReason: string | null; hasLessons: boolean }) {
  const t = useTranslations("timetable");
  const err = useTtError();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const run = () =>
    start(async () => {
      const r = await generateTimetableAction();
      if (!r.ok) return void toast.error(err(r.error));
      const missing = r.report.unplaced.reduce((n, u) => n + u.missing, 0);
      if (missing) toast.warning(t("generatedPartial", { placed: r.report.stats.lessonsPlaced, missing }));
      else toast.success(t("generatedAll", { placed: r.report.stats.lessonsPlaced, ms: r.report.stats.ms }));
      setOpen(false);
      router.refresh();
    });
  const label = hasLessons ? t("regenerate") : t("generate");
  if (disabledReason)
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span tabIndex={0}>
            <Button disabled>{label}</Button>
          </span>
        </TooltipTrigger>
        <TooltipContent>{disabledReason}</TooltipContent>
      </Tooltip>
    );
  return (
    <>
      <Button onClick={() => (hasLessons ? setOpen(true) : run())} disabled={pending} data-testid="generate">
        {pending ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
        {label}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("regenerateTitle")}</DialogTitle>
            <DialogDescription>{t("regenerateBody")}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              {t("cancel")}
            </Button>
            <Button onClick={run} disabled={pending} data-testid="confirm-generate">
              {pending && <Loader2 className="size-4 animate-spin" />}
              {t("regenerate")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
