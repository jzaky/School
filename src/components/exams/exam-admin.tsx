"use client";

import { useMemo, useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { Loader2, Pencil, Plus, Send, Trash2, Wand2 } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Field, GradePicker, useActionError } from "@/components/calendar-admin/shared";
import { applySuggestionAction, deleteSittingAction, previewSuggestionAction, publishSittingsAction, saveSittingAction, type SittingInput, type SuggestOptions } from "@/server/exams/actions";

export type Option = { value: string; label: string };

function StaffChecklist({ staff, value, onChange }: { staff: Option[]; value: string[]; onChange: (v: string[]) => void }) {
  const t = useTranslations("exams");
  const [q, setQ] = useState("");
  const shown = staff.filter((s) => s.label.toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <div className="space-y-2">
      <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("searchStaff")} />
      <div className="grid max-h-44 gap-1 overflow-y-auto rounded-lg border p-2 sm:grid-cols-2">
        {shown.map((s) => (
          <label key={s.value} className="flex cursor-pointer items-center gap-2 rounded-md p-1 text-sm hover:bg-muted/50">
            <Checkbox checked={value.includes(s.value)} onCheckedChange={(c) => onChange(c ? [...value, s.value] : value.filter((x) => x !== s.value))} />
            <span className="truncate">{s.label}</span>
          </label>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">{t("selectedCount", { count: value.length })}</p>
    </div>
  );
}

export function SittingDialog({ termId, subjects, staff, grades, initial, defaultDate }: { termId: string | null; subjects: Option[]; staff: Option[]; grades: number[]; initial?: SittingInput; defaultDate: string }) {
  const t = useTranslations("exams");
  const tc = useTranslations("common");
  const err = useActionError();
  const router = useRouter();
  const blank: SittingInput = { id: null, termId, subjectId: "", gradeLevel: grades[0] ?? 9, date: defaultDate, startTime: "08:30", endTime: "10:00", room: "", invigilatorIds: [] };
  const [open, setOpen] = useState(false);
  const [f, setF] = useState<SittingInput>(initial ?? blank);
  const [pending, start] = useTransition();
  const valid = f.subjectId && f.date && f.startTime < f.endTime;
  const submit = () =>
    start(async () => {
      const res = await saveSittingAction(f);
      if (!res.ok) return void toast.error(err(res.error));
      toast.success(t("sittingSaved"));
      setOpen(false);
      router.refresh();
    });
  return (
    <>
      {initial ? (
        <Button variant="ghost" size="icon-sm" onClick={() => (setF(initial), setOpen(true))} aria-label={tc("edit")} data-testid="sitting-edit">
          <Pencil className="size-3.5" />
        </Button>
      ) : (
        <Button variant="outline" onClick={() => (setF(blank), setOpen(true))} data-testid="add-sitting">
          <Plus className="size-4" />
          {t("addSitting")}
        </Button>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{initial ? t("editSitting") : t("addSitting")}</DialogTitle>
            <DialogDescription>{t("sittingBody")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={t("subject")}>
                <Select value={f.subjectId} onValueChange={(v) => setF({ ...f, subjectId: v })}>
                  <SelectTrigger className="w-full" data-testid="sitting-subject">
                    <SelectValue placeholder={t("chooseSubject")} />
                  </SelectTrigger>
                  <SelectContent>
                    {subjects.map((s) => (
                      <SelectItem key={s.value} value={s.value}>
                        {s.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label={t("grade")}>
                <Select value={String(f.gradeLevel)} onValueChange={(v) => setF({ ...f, gradeLevel: Number(v) })}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {grades.map((g) => (
                      <SelectItem key={g} value={String(g)}>
                        {t("gradeN", { grade: g })}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label={t("date")} htmlFor="sit-date">
                <Input id="sit-date" type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} />
              </Field>
              <Field label={t("room")} htmlFor="sit-room">
                <Input id="sit-room" value={f.room} onChange={(e) => setF({ ...f, room: e.target.value })} />
              </Field>
              <Field label={t("start")} htmlFor="sit-st">
                <Input id="sit-st" type="time" value={f.startTime} onChange={(e) => setF({ ...f, startTime: e.target.value })} />
              </Field>
              <Field label={t("end")} htmlFor="sit-et">
                <Input id="sit-et" type="time" value={f.endTime} onChange={(e) => setF({ ...f, endTime: e.target.value })} />
              </Field>
            </div>
            <Field label={t("invigilators")}>
              <StaffChecklist staff={staff} value={f.invigilatorIds} onChange={(v) => setF({ ...f, invigilatorIds: v })} />
            </Field>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              {tc("cancel")}
            </Button>
            <Button onClick={submit} disabled={pending || !valid} data-testid="sitting-save">
              {pending && <Loader2 className="size-4 animate-spin" />}
              {tc("save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function DeleteSittingButton({ id, label }: { id: string; label: string }) {
  const t = useTranslations("exams");
  const tc = useTranslations("common");
  const err = useActionError();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  return (
    <>
      <Button variant="ghost" size="icon-sm" onClick={() => setOpen(true)} aria-label={tc("delete")} data-testid="sitting-delete">
        <Trash2 className="size-3.5" />
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("deleteTitle")}</DialogTitle>
            <DialogDescription>{t("deleteBody", { label })}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              {tc("cancel")}
            </Button>
            <Button
              variant="destructive"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const res = await deleteSittingAction(id);
                  if (!res.ok) return void toast.error(err(res.error));
                  setOpen(false);
                  router.refresh();
                })
              }
            >
              {pending && <Loader2 className="size-4 animate-spin" />}
              {tc("delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

type Preview = Awaited<ReturnType<typeof previewSuggestionAction>>;

export function SuggestDialog({ termId, grades, staff, defaultStart, defaultEnd }: { termId: string | null; grades: number[]; staff: Option[]; defaultStart: string; defaultEnd: string }) {
  const t = useTranslations("exams");
  const tc = useTranslations("common");
  const locale = useLocale();
  const err = useActionError();
  const router = useRouter();
  const init: SuggestOptions = { termId, windowStart: defaultStart, windowEnd: defaultEnd, grades: grades.filter((g) => g >= 9), maxPerDay: 2, sessions: ["08:30", "11:30"], durationMin: 90, rooms: ["Exam Hall A", "Exam Hall B", "Sports Hall", "Library"], invigilatorIds: [] };
  const [open, setOpen] = useState(false);
  const [o, setO] = useState<SuggestOptions>(init);
  const [rooms, setRooms] = useState(init.rooms.join(", "));
  const [preview, setPreview] = useState<Preview | null>(null);
  const [pending, start] = useTransition();
  const opts = (): SuggestOptions => ({ ...o, rooms: rooms.split(",").map((r) => r.trim()).filter(Boolean), sessions: o.sessions.filter(Boolean) });
  const staffName = useMemo(() => new Map(staff.map((s) => [s.value, s.label])), [staff]);
  const fmtDay = (k: string) => new Intl.DateTimeFormat(locale === "ar" ? "ar-AE" : "en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${k}T12:00:00Z`));
  const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

  const runPreview = () =>
    start(async () => {
      const res = await previewSuggestionAction(opts());
      if (!res.ok) return void toast.error(err(res.error));
      setPreview(res);
    });
  const apply = () =>
    start(async () => {
      const res = await applySuggestionAction(opts());
      if (!res.ok) return void toast.error(err(res.error));
      toast.success(t("suggestApplied", { count: res.count ?? 0 }));
      setOpen(false);
      setPreview(null);
      router.refresh();
    });

  return (
    <>
      <Button variant="outline" onClick={() => (setO(init), setRooms(init.rooms.join(", ")), setPreview(null), setOpen(true))} data-testid="suggest-schedule">
        <Wand2 className="size-4" />
        {t("suggest")}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>{t("suggestTitle")}</DialogTitle>
            <DialogDescription>{t("suggestBody")}</DialogDescription>
          </DialogHeader>
          {!preview?.ok ? (
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label={t("windowStart")} htmlFor="sg-start">
                  <Input id="sg-start" type="date" value={o.windowStart} onChange={(e) => setO({ ...o, windowStart: e.target.value })} />
                </Field>
                <Field label={t("windowEnd")} htmlFor="sg-end">
                  <Input id="sg-end" type="date" value={o.windowEnd} onChange={(e) => setO({ ...o, windowEnd: e.target.value })} />
                </Field>
                <Field label={t("session1")} htmlFor="sg-s1">
                  <Input id="sg-s1" type="time" value={o.sessions[0] ?? ""} onChange={(e) => setO({ ...o, sessions: [e.target.value, o.sessions[1] ?? ""] })} />
                </Field>
                <Field label={t("session2")} htmlFor="sg-s2">
                  <Input id="sg-s2" type="time" value={o.sessions[1] ?? ""} onChange={(e) => setO({ ...o, sessions: [o.sessions[0] ?? "", e.target.value] })} />
                </Field>
                <Field label={t("maxPerDay")}>
                  <Select value={String(o.maxPerDay)} onValueChange={(v) => setO({ ...o, maxPerDay: Number(v) })}>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="1">{t("perDay", { count: 1 })}</SelectItem>
                      <SelectItem value="2">{t("perDay", { count: 2 })}</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
                <Field label={t("duration")} htmlFor="sg-dur">
                  <Input id="sg-dur" type="number" min={30} max={240} step={15} value={o.durationMin} onChange={(e) => setO({ ...o, durationMin: Number(e.target.value) || 90 })} />
                </Field>
              </div>
              <Field label={t("grades")}>
                <GradePicker grades={grades} value={o.grades} onChange={(v) => setO({ ...o, grades: v })} />
              </Field>
              <Field label={t("rooms")} htmlFor="sg-rooms" hint={t("roomsHint")}>
                <Input id="sg-rooms" value={rooms} onChange={(e) => setRooms(e.target.value)} />
              </Field>
              <Field label={t("invigilatorPool")}>
                <StaffChecklist staff={staff} value={o.invigilatorIds} onChange={(v) => setO({ ...o, invigilatorIds: v })} />
              </Field>
            </div>
          ) : (
            <div className="space-y-3" data-testid="suggest-preview">
              <Alert>
                <AlertDescription>{t("previewSummary", { count: preview.result.sittings.length, days: preview.result.days.length })}</AlertDescription>
              </Alert>
              {preview.result.unplaced.length > 0 && (
                <Alert variant="destructive">
                  <AlertDescription>{t("unplaced", { count: preview.result.unplaced.length })}</AlertDescription>
                </Alert>
              )}
              {preview.result.sittings.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("nothingToSchedule")}</p>
              ) : (
                <div className="max-h-80 overflow-y-auto rounded-lg border">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-muted text-xs text-muted-foreground">
                      <tr>
                        <th className="px-3 py-2 text-start font-medium">{t("date")}</th>
                        <th className="px-3 py-2 text-start font-medium">{t("time")}</th>
                        <th className="px-3 py-2 text-start font-medium">{t("grade")}</th>
                        <th className="px-3 py-2 text-start font-medium">{t("subject")}</th>
                        <th className="hidden px-3 py-2 text-start font-medium sm:table-cell">{t("room")}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {preview.result.sittings.map((s, i) => (
                        <tr key={i}>
                          <td className="px-3 py-1.5 whitespace-nowrap">{fmtDay(s.dateKey)}</td>
                          <td className="px-3 py-1.5 tabular-nums">{hhmm(s.startMinute)}</td>
                          <td className="px-3 py-1.5">{s.gradeLevel}</td>
                          <td className="px-3 py-1.5">{locale === "ar" ? preview.subjectNames[s.subjectId]?.ar : preview.subjectNames[s.subjectId]?.en}</td>
                          <td className="hidden px-3 py-1.5 text-muted-foreground sm:table-cell">
                            {s.room ?? "-"}
                            {s.invigilatorIds.length > 0 && ` · ${s.invigilatorIds.map((x) => staffName.get(x) ?? "").join(", ")}`}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            {preview?.ok ? (
              <>
                <Button variant="outline" onClick={() => setPreview(null)}>
                  {tc("back")}
                </Button>
                <Button onClick={apply} disabled={pending || !preview.result.sittings.length} data-testid="suggest-apply">
                  {pending && <Loader2 className="size-4 animate-spin" />}
                  {t("saveDrafts", { count: preview.result.sittings.length })}
                </Button>
              </>
            ) : (
              <>
                <Button variant="outline" onClick={() => setOpen(false)}>
                  {tc("cancel")}
                </Button>
                <Button onClick={runPreview} disabled={pending || !o.grades.length} data-testid="suggest-preview-btn">
                  {pending && <Loader2 className="size-4 animate-spin" />}
                  {t("preview")}
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function PublishExamsButton({ termId, gradeLevel, drafts, clashes }: { termId: string | null; gradeLevel: number | null; drafts: number; clashes: number }) {
  const t = useTranslations("exams");
  const tc = useTranslations("common");
  const err = useActionError();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const reason = drafts === 0 ? t("publishNoDrafts") : clashes > 0 ? t("publishClashes") : null;
  const button = (
    <Button onClick={() => setOpen(true)} disabled={Boolean(reason)} data-testid="publish-exams">
      <Send className="size-4" />
      {t("publish", { count: drafts })}
    </Button>
  );
  return (
    <>
      {reason ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <span tabIndex={0}>{button}</span>
          </TooltipTrigger>
          <TooltipContent>{reason}</TooltipContent>
        </Tooltip>
      ) : (
        button
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("publishTitle")}</DialogTitle>
            <DialogDescription>{t("publishBody", { count: drafts })}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              {tc("cancel")}
            </Button>
            <Button
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const res = await publishSittingsAction({ termId, gradeLevel });
                  if (!res.ok) return void toast.error(err(res.error));
                  toast.success(t("published", { count: res.count ?? 0, people: res.notified ?? 0 }));
                  setOpen(false);
                  router.refresh();
                })
              }
              data-testid="publish-exams-confirm"
            >
              {pending && <Loader2 className="size-4 animate-spin" />}
              {t("publishConfirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
