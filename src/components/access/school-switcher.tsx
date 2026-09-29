"use client";

import { useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Building2, Check } from "lucide-react";
import { DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { switchSchoolAction } from "@/server/access/actions";

/** Schools this person belongs to, inside the user menu. Only shown for people in more than one school. */
export function SchoolSwitcherItems({ schools }: { schools: Array<{ id: string; name: string; current: boolean }> }) {
  const t = useTranslations("shell");
  const locale = useLocale();
  const [pending, start] = useTransition();
  return (
    <>
      <DropdownMenuSeparator />
      <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">{t("switchSchool")}</DropdownMenuLabel>
      {schools.map((s) => (
        <DropdownMenuItem key={s.id} disabled={pending || s.current} onSelect={() => start(async () => void (await switchSchoolAction(s.id, locale)))} data-testid="switch-school">
          <Building2 className="size-4" />
          <span className="flex-1 truncate">{s.name}</span>
          {s.current && <Check className="size-4" />}
        </DropdownMenuItem>
      ))}
    </>
  );
}
