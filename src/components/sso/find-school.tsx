"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { Loader2, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { findSchoolAction } from "@/server/sso/actions";

/** "Use your school's sign-in page": the school's address, as in horizon.app/login/<address>. */
export function FindSchoolForm() {
  const t = useTranslations("sso.signin");
  const [state, action, pending] = useActionState(findSchoolAction, { error: null });
  return (
    <form action={action} className="space-y-2" data-testid="find-school">
      <Label htmlFor="school-address" className="text-sm font-medium">
        {t("findSchool")}
      </Label>
      <p className="text-xs text-muted-foreground">{t("findSchoolHelp")}</p>
      <div className="flex gap-2">
        <Input id="school-address" name="school" dir="ltr" className="min-w-0 text-start" placeholder={t("findSchoolPlaceholder")} autoCapitalize="none" autoCorrect="off" required />
        <Button type="submit" variant="outline" disabled={pending} aria-label={t("findSchoolGo")}>
          {pending ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />}
          <span className="hidden sm:inline">{t("findSchoolGo")}</span>
        </Button>
      </div>
      {state.error && (
        <p role="alert" className="text-xs text-danger">
          {t("findSchoolNotFound")}
        </p>
      )}
    </form>
  );
}
