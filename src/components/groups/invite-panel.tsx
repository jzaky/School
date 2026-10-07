"use client";

import { useState, useTransition } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { toast } from "sonner";
import { Copy, KeyRound, Loader2, Plus } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Pill } from "@/components/app/badges";
import { createInviteAction, revokeInviteAction } from "@/server/groups/actions";

export type InviteRow = { id: string; hint: string; state: "OPEN" | "USED" | "REVOKED" | "EXPIRED"; created: string; expires: string; usedBy: string | null };

export function InvitePanel({ groupId, invites, isAdmin }: { groupId: string; invites: InviteRow[]; isAdmin: boolean }) {
  const t = useTranslations("groups");
  const router = useRouter();
  const fmt = useFormatter();
  const [pending, start] = useTransition();
  const [code, setCode] = useState<{ code: string; expires: string } | null>(null);

  const create = () =>
    start(async () => {
      const res = await createInviteAction(groupId);
      if (!res.ok) return void toast.error(t(`error.${res.error === "forbidden" ? "forbidden" : "generic"}`));
      setCode({ code: res.code, expires: res.expiresAt });
      router.refresh();
    });
  const revoke = (id: string) =>
    start(async () => {
      const res = await revokeInviteAction(groupId, id);
      if (res.ok) toast.success(t("invites.revoked"));
      else toast.error(t("error.generic"));
      router.refresh();
    });
  const tone = { OPEN: "brand", USED: "success", REVOKED: "neutral", EXPIRED: "neutral" } as const;

  return (
    <div className="space-y-4">
      {isAdmin ? (
        <Button onClick={create} disabled={pending} data-testid="group-invite-create">
          {pending ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
          {t("invites.create")}
        </Button>
      ) : (
        <p className="text-sm text-muted-foreground">{t("invites.viewerNote")}</p>
      )}
      {invites.length === 0 ? (
        <p className="rounded-lg border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">{t("invites.empty")}</p>
      ) : (
        <ul className="divide-y rounded-lg border" role="list" data-testid="group-invite-list">
          {invites.map((i) => (
            <li key={i.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
              <KeyRound className="size-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <div className="font-medium" dir="ltr">
                  {t("invites.endsWith", { hint: i.hint })}
                </div>
                <div className="text-xs text-muted-foreground">
                  {i.state === "USED" && i.usedBy ? t("invites.usedBy", { school: i.usedBy }) : t("invites.createdExpires", { created: i.created, expires: i.expires })}
                </div>
              </div>
              <Pill tone={tone[i.state]}>{t(`invites.state.${i.state}`)}</Pill>
              {isAdmin && i.state === "OPEN" && (
                <Button size="sm" variant="ghost" disabled={pending} onClick={() => revoke(i.id)} data-testid={`group-invite-revoke-${i.id}`}>
                  {t("invites.revoke")}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      <Dialog open={!!code} onOpenChange={(o) => !o && setCode(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("invites.codeTitle")}</DialogTitle>
            <DialogDescription>{t("invites.codeBody")}</DialogDescription>
          </DialogHeader>
          <div className="rounded-xl border bg-muted/40 px-4 py-5 text-center font-mono text-2xl font-semibold tracking-widest" dir="ltr" data-testid="group-invite-code">
            {code?.code}
          </div>
          <p className="text-xs text-muted-foreground">{t("invites.codeOnce", { expires: code ? fmt.dateTime(new Date(code.expires), { day: "numeric", month: "long", year: "numeric" }) : "" })}</p>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                if (code) void navigator.clipboard?.writeText(code.code).then(() => toast.success(t("invites.copied")));
              }}
            >
              <Copy className="size-4" />
              {t("invites.copy")}
            </Button>
            <Button onClick={() => setCode(null)}>{t("done")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
