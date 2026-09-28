"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { motion } from "framer-motion";
import { CalendarX2, Clock, MapPin, Sparkles, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { fmtTime, localeTag } from "@/lib/format";
import { getSlotsAction, type SlotDay } from "@/server/appointments/actions";
import type { BookingSetup } from "@/server/appointments/booking-setup";

export type BookingChoice = { hostId: string | null; start: string; hostName: string };

function dayLabel(key: string, locale: string) {
  const d = new Date(`${key}T08:00:00Z`);
  const tag = localeTag({ locale: locale as "en" | "ar" });
  return {
    weekday: new Intl.DateTimeFormat(tag, { weekday: "short", timeZone: "Asia/Dubai" }).format(d),
    day: new Intl.DateTimeFormat(tag, { day: "numeric", timeZone: "Asia/Dubai" }).format(d),
    month: new Intl.DateTimeFormat(tag, { month: "short", timeZone: "Asia/Dubai" }).format(d),
  };
}

export function BookingPicker({ setup, value, onChange, rescheduleOf }: { setup: BookingSetup; value: BookingChoice | null; onChange: (c: BookingChoice | null) => void; rescheduleOf?: string }) {
  const t = useTranslations("booking");
  const locale = useLocale();
  const roundRobin = setup.type.hostMode === "ROUND_ROBIN" && setup.hosts.length > 1;
  const [hostId, setHostId] = useState<string | null>(roundRobin ? null : setup.hosts.length === 1 ? setup.hosts[0].id : (value?.hostId ?? null));
  const [hostChosen, setHostChosen] = useState(roundRobin || setup.hosts.length === 1 || Boolean(value));
  const [days, setDays] = useState<SlotDay[] | null>(null);
  const [dayKey, setDayKey] = useState<string | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    if (!hostChosen) return;
    setDays(null);
    start(async () => {
      const res = await getSlotsAction({ typeId: setup.type.id, hostId, days: 21, rescheduleOf });
      setDays(res);
      setDayKey((k) => (k && res.some((d) => d.key === k) ? k : (res[0]?.key ?? null)));
    });
  }, [hostId, hostChosen, setup.type.id, rescheduleOf]);

  const day = useMemo(() => days?.find((d) => d.key === dayKey) ?? null, [days, dayKey]);
  const hostName = (id: string | null) => (id ? setup.hosts.find((h) => h.id === id)?.name ?? "" : t("firstAvailable"));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <Clock className="size-4" />
          {t("minutes", { n: setup.type.durationMin })}
        </span>
        {setup.type.location && (
          <span className="inline-flex items-center gap-1.5">
            <MapPin className="size-4" />
            {setup.type.location}
          </span>
        )}
      </div>

      {setup.hosts.length > 1 && (
        <section>
          <h3 className="mb-2 text-sm font-semibold">{t("chooseWho")}</h3>
          <div className="grid gap-2 sm:grid-cols-2">
            {roundRobin && (
              <HostButton
                active={hostChosen && hostId === null}
                onClick={() => {
                  setHostId(null);
                  setHostChosen(true);
                  onChange(null);
                }}
                icon={<Sparkles className="size-4" />}
                name={t("firstAvailable")}
                detail={t("firstAvailableHint")}
                testId="host-any"
              />
            )}
            {setup.hosts.map((h) => (
              <HostButton
                key={h.id}
                active={hostChosen && hostId === h.id}
                onClick={() => {
                  setHostId(h.id);
                  setHostChosen(true);
                  onChange(null);
                }}
                initials={h.initials}
                name={h.name}
                detail={h.detail || h.title}
                testId={`host-${h.id}`}
              />
            ))}
          </div>
        </section>
      )}

      {hostChosen && (
        <section>
          <h3 className="mb-2 text-sm font-semibold">{t("chooseDay")}</h3>
          {days === null || pending ? (
            <div className="flex gap-2 overflow-hidden">
              {Array.from({ length: 7 }).map((_, i) => (
                <div key={i} className="skeleton h-20 w-16 shrink-0" />
              ))}
            </div>
          ) : days.length === 0 ? (
            <div className="flex items-center gap-3 rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
              <CalendarX2 className="size-5" />
              {t("noSlots")}
            </div>
          ) : (
            <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-2" data-testid="day-strip">
              {days.map((d) => {
                const l = dayLabel(d.key, locale);
                const on = d.key === dayKey;
                return (
                  <button
                    key={d.key}
                    type="button"
                    onClick={() => setDayKey(d.key)}
                    data-testid={`day-${d.key}`}
                    className={cn(
                      "flex w-16 shrink-0 flex-col items-center rounded-xl border py-2.5 transition",
                      on ? "border-brand bg-brand text-brand-foreground shadow-sm" : "bg-card hover:border-brand/40",
                    )}
                  >
                    <span className={cn("text-[11px] font-medium uppercase", on ? "text-brand-foreground/80" : "text-muted-foreground")}>{l.weekday}</span>
                    <span className="text-lg font-semibold tabular-nums leading-tight">{l.day}</span>
                    <span className={cn("text-[11px]", on ? "text-brand-foreground/80" : "text-muted-foreground")}>{l.month}</span>
                  </button>
                );
              })}
            </div>
          )}
        </section>
      )}

      {day && !pending && (
        <section>
          <h3 className="mb-2 text-sm font-semibold">{t("chooseTime")}</h3>
          <motion.div key={day.key} initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="grid grid-cols-3 gap-2 sm:grid-cols-5" data-testid="time-grid">
            {day.slots.map((s) => {
              const on = value?.start === s.start;
              return (
                <button
                  key={s.start}
                  type="button"
                  data-testid="time-slot"
                  onClick={() => onChange({ hostId, start: s.start, hostName: hostName(hostId) })}
                  className={cn("rounded-lg border py-2 text-sm font-medium tabular-nums transition", on ? "border-brand bg-brand text-brand-foreground" : "bg-card hover:border-brand/40 hover:text-brand")}
                >
                  {fmtTime({ locale: locale as "en" | "ar" }, s.start)}
                  {!hostId && s.hostIds.length > 1 && (
                    <span className={cn("ms-1 inline-flex items-center text-[10px]", on ? "text-brand-foreground/80" : "text-muted-foreground")}>
                      <Users className="me-0.5 size-3" />
                      {s.hostIds.length}
                    </span>
                  )}
                </button>
              );
            })}
          </motion.div>
        </section>
      )}
    </div>
  );
}

function HostButton({ active, onClick, name, detail, initials, icon, testId }: { active: boolean; onClick: () => void; name: string; detail?: string; initials?: string; icon?: React.ReactNode; testId?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={testId}
      className={cn("flex items-center gap-3 rounded-xl border p-3 text-start transition", active ? "border-brand bg-brand-soft/60 ring-1 ring-brand/30" : "bg-card hover:border-brand/30")}
    >
      <span className={cn("grid size-9 shrink-0 place-items-center rounded-full text-xs font-semibold", active ? "bg-brand text-brand-foreground" : "bg-muted text-muted-foreground")}>{icon ?? initials}</span>
      <span className="min-w-0">
        <span className="block truncate text-sm font-medium">{name}</span>
        {detail && <span className="block truncate text-xs text-muted-foreground">{detail}</span>}
      </span>
    </button>
  );
}
