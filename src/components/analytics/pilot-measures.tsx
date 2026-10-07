import { getTranslations } from "next-intl/server";
import { CalendarCheck2, Download, FileSignature, Gauge, UserCheck, Users } from "lucide-react";
import type { PilotMeasures } from "@/server/analytics/pilot";
import type { FormatPrefs } from "@/lib/format";
import { fmtNumber } from "@/lib/format";
import { Panel, PanelHeader } from "@/components/app/panel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/** Pilot measures for leadership, for a chosen period, with a CSV download. */
export async function PilotMeasuresPanel({ m, from, to, days, prefs }: { m: PilotMeasures; from: string; to: string; days: number; prefs: FormatPrefs }) {
  const t = await getTranslations("pilot");
  const n = (v: number) => fmtNumber(prefs, v);
  const pctText = (v: number | null) => (v === null ? t("noData") : `${fmtNumber(prefs, v)}%`);
  const tiles = [
    { key: "staff", icon: UserCheck, value: n(m.staffActive), hint: t("staffHint", { total: n(m.staffTotal) }) },
    { key: "adoption", icon: Users, value: pctText(m.adoptionPct), hint: t("adoptionHint", { linked: n(m.parentAccountsLinked), total: n(m.guardiansOnRecord) }) },
    { key: "letters", icon: FileSignature, value: m.letterMedianDays === null ? t("noData") : t("daysValue", { n: fmtNumber(prefs, m.letterMedianDays) }), hint: t("lettersHint", { n: n(m.lettersIssued) }) },
    { key: "onTime", icon: Gauge, value: pctText(m.onTimePct), hint: t("onTimeHint", { onTime: n(m.requestsClosedOnTime), total: n(m.requestsClosed) }) },
    { key: "meetings", icon: CalendarCheck2, value: n(m.meetingsBooked), hint: t("meetingsHint") },
  ];
  const csv = `/api/admin/pilot-measures?from=${from}&to=${to}`;
  return (
    <Panel>
      <PanelHeader
        title={t("title")}
        description={t("subtitle")}
        action={
          <Button size="sm" variant="outline" asChild>
            <a href={csv} download data-testid="pilot-csv">
              <Download className="size-4" />
              {t("csv")}
            </a>
          </Button>
        }
      />
      <form method="get" className="mb-4 flex flex-wrap items-end gap-3" data-testid="pilot-period">
        <input type="hidden" name="days" value={days} />
        <label className="space-y-1 text-xs text-muted-foreground">
          <span className="block">{t("from")}</span>
          <Input type="date" name="pfrom" defaultValue={from} className="h-9 w-40" dir="ltr" required />
        </label>
        <label className="space-y-1 text-xs text-muted-foreground">
          <span className="block">{t("to")}</span>
          <Input type="date" name="pto" defaultValue={to} className="h-9 w-40" dir="ltr" required />
        </label>
        <Button type="submit" size="sm" variant="secondary">
          {t("apply")}
        </Button>
      </form>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {tiles.map((x) => (
          <div key={x.key} className="rounded-lg border p-3" data-testid={`pilot-${x.key}`}>
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <x.icon className="size-3.5" />
              {t(`tile.${x.key}`)}
            </p>
            <p className="mt-1 text-xl font-semibold tabular-nums">{x.value}</p>
            <p className="text-xs text-muted-foreground">{x.hint}</p>
          </div>
        ))}
      </div>
      <p className="mt-3 text-xs text-muted-foreground">{t("footnote")}</p>
    </Panel>
  );
}
