"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { revealIdentifierAction } from "@/server/students/actions";

export function RevealId({ studentId, field, masked, allowed }: { studentId: string; field: "emiratesId" | "passport"; masked: string; allowed: boolean }) {
  const t = useTranslations("students");
  const [value, setValue] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <span className="inline-flex items-center gap-2">
      <span className="font-mono text-sm" dir="ltr" data-testid={`id-${field}`}>
        {value ?? masked}
      </span>
      {allowed ? (
        <button
          type="button"
          className="text-muted-foreground hover:text-foreground"
          aria-label={value ? t("hide") : t("reveal")}
          onClick={() => (value ? setValue(null) : start(async () => { const r = await revealIdentifierAction({ studentId, field }); if (r.ok) setValue(r.value); }))}
          data-testid={`reveal-${field}`}
        >
          {pending ? <Loader2 className="size-3.5 animate-spin" /> : value ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
        </button>
      ) : (
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="cursor-not-allowed text-muted-foreground/50">
              <Eye className="size-3.5" />
            </span>
          </TooltipTrigger>
          <TooltipContent>{t("revealNoPermission")}</TooltipContent>
        </Tooltip>
      )}
      {value && <span className="text-[11px] text-muted-foreground">{t("revealAudited")}</span>}
    </span>
  );
}
