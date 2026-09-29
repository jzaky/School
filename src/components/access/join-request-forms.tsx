"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Check, Loader2, X } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PickerCombobox, type PickerOption } from "@/components/forms/picker-combobox";
import { approveJoinRequestAction, rejectJoinRequestAction } from "@/server/access/actions";

export type Candidate = { id: string; label: string; detail: string; reasons: string[]; exact: boolean; taken: boolean };

export function JoinRequestDecision({
  requestId,
  kind,
  candidates,
  preselected,
  roles,
  students,
}: {
  requestId: string;
  kind: "PARENT" | "STAFF" | "STUDENT";
  candidates: Candidate[];
  preselected: string[];
  roles: Array<{ key: string; label: string }>;
  students: PickerOption[];
}) {
  const t = useTranslations("joinRequests");
  const router = useRouter();
  const [selected, setSelected] = useState<string[]>(preselected);
  const [extra, setExtra] = useState<Candidate[]>([]);
  const [pick, setPick] = useState("");
  const [roleKeys, setRoleKeys] = useState<string[]>(["teacher"]);
  const [note, setNote] = useState("");
  const [rejectOpen, setRejectOpen] = useState(false);
  const [pending, start] = useTransition();
  const err = (code?: string) => (code && t.has(`error.${code}`) ? t(`error.${code}`) : t("error.generic"));
  const all = [...candidates, ...extra];

  const approve = () =>
    start(async () => {
      const res = await approveJoinRequestAction({ requestId, studentIds: selected, roleKeys: kind === "STAFF" ? roleKeys : [], note });
      if (!res.ok) return void toast.error(err(res.error));
      toast.success(t("approved"));
      router.refresh();
    });
  const reject = () =>
    start(async () => {
      const res = await rejectJoinRequestAction({ requestId, note });
      if (!res.ok) return void toast.error(err(res.error));
      toast.success(t("rejected"));
      setRejectOpen(false);
      router.refresh();
    });
  const canApprove = kind === "STAFF" ? roleKeys.length > 0 : selected.length > 0 && (kind !== "STUDENT" || selected.length === 1);

  return (
    <div className="space-y-3">
      {kind === "STAFF" ? (
        <div className="space-y-1.5">
          <Label>{t("giveRoles")}</Label>
          <div className="grid max-h-48 gap-1 overflow-y-auto rounded-lg border p-2 sm:grid-cols-2">
            {roles.map((r) => (
              <label key={r.key} className="flex cursor-pointer items-center gap-2 rounded-md p-1.5 text-sm hover:bg-muted/50">
                <Checkbox checked={roleKeys.includes(r.key)} onCheckedChange={(c) => setRoleKeys((v) => (c ? [...v, r.key] : v.filter((k) => k !== r.key)))} />
                {r.label}
              </label>
            ))}
          </div>
        </div>
      ) : (
        <div className="space-y-1.5">
          <Label>{t("linkChildren")}</Label>
          {all.length === 0 && <p className="text-xs text-muted-foreground">{t("noMatches")}</p>}
          <div className="space-y-1">
            {all.map((c) => (
              <label key={c.id} className="flex cursor-pointer items-start gap-2 rounded-lg border p-2 hover:bg-muted/40 has-disabled:cursor-not-allowed has-disabled:opacity-60" data-testid="jr-candidate">
                <Checkbox className="mt-0.5" disabled={c.taken} checked={selected.includes(c.id)} onCheckedChange={(v) => setSelected((cur) => (v ? [...cur, c.id] : cur.filter((x) => x !== c.id)))} />
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-1.5 text-sm font-medium">
                    {c.label}
                    {c.exact && <span className="rounded-full bg-success-soft px-1.5 text-[11px] text-success">{t("exactMatch")}</span>}
                    {c.taken && <span className="rounded-full bg-muted px-1.5 text-[11px] text-muted-foreground">{t("hasAccount")}</span>}
                  </span>
                  <span className="block text-xs text-muted-foreground">{c.detail}</span>
                  {c.reasons.length > 0 && <span className="block text-xs text-muted-foreground">{t("matchedOn", { reasons: c.reasons.map((r) => t(`reason.${r}`)).join(", ") })}</span>}
                </span>
              </label>
            ))}
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <div className="min-w-0 flex-1">
              <PickerCombobox options={students.filter((s) => !all.some((c) => c.id === s.value))} value={pick} onChange={setPick} placeholder={t("findAnother")} />
            </div>
            <Button
              type="button"
              variant="outline"
              disabled={!pick}
              onClick={() => {
                const s = students.find((x) => x.value === pick);
                if (s) {
                  setExtra((e) => [...e, { id: s.value, label: s.label, detail: s.hint ?? "", reasons: [], exact: false, taken: false }]);
                  setSelected((cur) => [...cur, s.value]);
                }
                setPick("");
              }}
            >
              {t("add")}
            </Button>
          </div>
        </div>
      )}
      <div className="space-y-1.5">
        <Label htmlFor={`note-${requestId}`}>{t("note")}</Label>
        <Textarea id={`note-${requestId}`} rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("notePlaceholder")} />
      </div>
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="outline" className="text-danger hover:text-danger" onClick={() => setRejectOpen(true)} disabled={pending} data-testid="jr-reject">
          <X className="size-4" />
          {t("reject")}
        </Button>
        <Button onClick={approve} disabled={pending || !canApprove} data-testid="jr-approve">
          {pending ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
          {t("approve")}
        </Button>
      </div>
      <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("rejectTitle")}</DialogTitle>
            <DialogDescription>{t("rejectBody")}</DialogDescription>
          </DialogHeader>
          <Textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("rejectPlaceholder")} data-testid="jr-reject-note" />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectOpen(false)}>
              {t("cancel")}
            </Button>
            <Button variant="destructive" onClick={reject} disabled={pending || note.trim().length < 2} data-testid="jr-reject-confirm">
              {t("reject")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
