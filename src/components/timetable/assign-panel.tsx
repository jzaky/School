"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Loader2, Wand2 } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Panel, PanelHeader } from "@/components/app/panel";
import { Pill } from "@/components/app/badges";
import { runAssignmentAction, setSectionTeacherAction } from "@/server/timetable/actions";
import type { UnassignedReason } from "@/server/timetable/assign";
import { useTtError } from "./lesson-dialog";

export type SectionRow = {
  id: string;
  name: string;
  grade: number;
  block: string | null;
  periods: number;
  teacherId: string | null;
  teacherName: string;
  qualified: string[];
  problem: UnassignedReason | null;
  suggestion: string | null;
};

const NONE = "none";

export function AssignPanel({ rows, teachers, suggestionNames }: { rows: SectionRow[]; teachers: Array<{ id: string; name: string }>; suggestionNames: Record<string, string> }) {
  const t = useTranslations("timetable");
  const err = useTtError();
  const router = useRouter();
  const [overwrite, setOverwrite] = useState(false);
  const [pending, start] = useTransition();
  const [busyRow, setBusyRow] = useState<string | null>(null);
  const empty = rows.filter((r) => !r.teacherId);
  const problems = rows.filter((r) => r.problem);

  const run = () =>
    start(async () => {
      const r = await runAssignmentAction({ overwrite });
      if (!r.ok) return void toast.error(err(r.error));
      toast.success(t("assignDone", { changed: r.changed, left: r.result.unassigned.length }));
      router.refresh();
    });
  const setTeacher = (classId: string, teacherId: string | null) => {
    setBusyRow(classId);
    start(async () => {
      const r = await setSectionTeacherAction({ classId, teacherId });
      setBusyRow(null);
      if (!r.ok) return void toast.error(err(r.error));
      toast.success(t("saved"));
      router.refresh();
    });
  };

  return (
    <div className="space-y-4">
      <Panel>
        <PanelHeader
          title={t("assignTitle")}
          description={t("assignBody")}
          action={
            <Button onClick={run} disabled={pending} data-testid="run-assign">
              {pending && !busyRow ? <Loader2 className="size-4 animate-spin" /> : <Wand2 className="size-4" />}
              {t("assignRun")}
            </Button>
          }
        />
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={overwrite} onCheckedChange={(c) => setOverwrite(Boolean(c))} data-testid="assign-overwrite" />
          {t("assignOverwrite")}
        </label>
        <p className="mt-2 text-xs text-muted-foreground">{t("assignSummary", { empty: empty.length, problems: problems.length })}</p>
      </Panel>

      {problems.length > 0 && (
        <Panel className="border-danger/30">
          <PanelHeader title={t("unassignableTitle")} description={t("unassignableBody")} />
          <ul className="divide-y" data-testid="unassignable">
            {problems.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                <span className="font-medium">{r.name}</span>
                <Pill tone="danger">{t(`unassigned.${r.problem}`)}</Pill>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      <div className="overflow-hidden rounded-xl border bg-card shadow-xs">
        <div className="hidden grid-cols-[minmax(0,1.3fr)_80px_90px_minmax(0,1.5fr)] gap-3 border-b bg-muted/30 px-4 py-2.5 text-xs font-medium text-muted-foreground lg:grid">
          <span>{t("colSection")}</span>
          <span>{t("colBlock")}</span>
          <span>{t("colPeriods")}</span>
          <span>{t("colTeacher")}</span>
        </div>
        <ul className="divide-y">
          {rows.map((r) => {
            const qualified = teachers.filter((x) => r.qualified.includes(x.id));
            const others = teachers.filter((x) => !r.qualified.includes(x.id));
            return (
              <li key={r.id} className="grid gap-2 px-4 py-2.5 lg:grid-cols-[minmax(0,1.3fr)_80px_90px_minmax(0,1.5fr)] lg:items-center" data-testid="section-row">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">{r.name}</div>
                  {!r.teacherId && r.suggestion && <div className="text-xs text-success">{t("wouldAssign", { name: suggestionNames[r.id] ?? "" })}</div>}
                </div>
                <div className="text-xs">{r.block ? <Pill>{t("blockN", { block: r.block })}</Pill> : <span className="text-muted-foreground">{t("core")}</span>}</div>
                <div className="text-xs tabular-nums text-muted-foreground">{t("perWeek", { n: r.periods })}</div>
                <Select value={r.teacherId ?? NONE} onValueChange={(v) => setTeacher(r.id, v === NONE ? null : v)} disabled={pending && busyRow === r.id}>
                  <SelectTrigger className="w-full" size="sm" data-testid="section-teacher">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>{t("noTeacher")}</SelectItem>
                    {qualified.map((x) => (
                      <SelectItem key={x.id} value={x.id}>
                        {x.name} ✓
                      </SelectItem>
                    ))}
                    {others.map((x) => (
                      <SelectItem key={x.id} value={x.id}>
                        {x.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
