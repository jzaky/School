"use client";

import { useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { ArrowUpRight, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { usePathname, useRouter } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { openSchoolAction } from "@/server/groups/actions";

/** Shown only when the person has a role in more than one group. */
export function GroupSwitcher({ groups, current }: { groups: Array<{ id: string; name: string }>; current: string }) {
  const t = useTranslations("groups");
  const router = useRouter();
  const pathname = usePathname();
  if (groups.length < 2) return null;
  return (
    <Select value={current} onValueChange={(g) => router.push(`${pathname}?g=${encodeURIComponent(g)}`)}>
      <SelectTrigger className="w-full sm:w-64" aria-label={t("switchGroup")}>
        <SelectValue>{groups.find((g) => g.id === current)?.name}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        {groups.map((g) => (
          <SelectItem key={g.id} value={g.id}>
            {g.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** Jump into a school. Works only with a membership there; otherwise disabled with the reason. */
export function OpenSchoolButton({ orgId, canOpen, schoolName }: { orgId: string; canOpen: boolean; schoolName: string }) {
  const t = useTranslations("groups");
  const locale = useLocale();
  const [pending, start] = useTransition();
  if (!canOpen) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span tabIndex={0} className="inline-flex" aria-label={t("openSchoolNoAccess")} data-testid={`open-school-disabled-${orgId}`}>
            <Button size="sm" variant="outline" disabled>
              {t("openSchool")}
            </Button>
          </span>
        </TooltipTrigger>
        <TooltipContent>{t("openSchoolNoAccess")}</TooltipContent>
      </Tooltip>
    );
  }
  return (
    <Button
      size="sm"
      variant="outline"
      disabled={pending}
      aria-label={t("openSchoolNamed", { school: schoolName })}
      data-testid={`open-school-${orgId}`}
      onClick={() =>
        start(async () => {
          const res = await openSchoolAction(orgId, locale);
          if (res && !res.ok) toast.error(t(`error.${res.error === "no_membership" ? "no_membership" : "generic"}`));
        })
      }
    >
      {pending ? <Loader2 className="size-4 animate-spin" /> : <ArrowUpRight className="size-4 rtl:-scale-x-100" />}
      {t("openSchool")}
    </Button>
  );
}
