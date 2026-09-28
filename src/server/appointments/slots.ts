// Slot calculation. Pure and deterministic: all inputs are passed in, times are Asia/Dubai (UTC+4, no DST).
// Pattern reimplemented from open scheduling tools: availability windows -> candidate slots -> remove conflicts.

export const DUBAI_OFFSET_MIN = 240;

export type Rule = { weekday: number; startMinute: number; endMinute: number };
export type Override = { date: string; isUnavailable: boolean; startMinute?: number | null; endMinute?: number | null };
export type Busy = { start: Date; end: Date; typeId?: string | null };
export type HostInput = { id: string; rules: Rule[]; overrides: Override[]; busy: Busy[] };
export type TypeInput = {
  id: string;
  durationMin: number;
  bufferBeforeMin: number;
  bufferAfterMin: number;
  minNoticeMin: number;
  dailyMax: number | null;
  horizonDays: number;
};
export type Slot = { start: Date; end: Date; hostIds: string[] };

/** YYYY-MM-DD of a Dubai calendar day. */
export function dubaiDateKey(d: Date) {
  return new Date(d.getTime() + DUBAI_OFFSET_MIN * 60000).toISOString().slice(0, 10);
}

/** UTC instant for minute-of-day `m` on Dubai date `key`. */
export function dubaiInstant(key: string, minute: number) {
  const [y, mo, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, mo - 1, d, 0, minute - DUBAI_OFFSET_MIN));
}

export function addDaysKey(key: string, days: number) {
  const [y, mo, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, mo - 1, d + days)).toISOString().slice(0, 10);
}

export function weekdayOfKey(key: string) {
  const [y, mo, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, mo - 1, d)).getUTCDay();
}

function windowsFor(host: HostInput, key: string): Array<[number, number]> {
  const ov = host.overrides.find((o) => o.date === key);
  if (ov) {
    if (ov.startMinute != null && ov.endMinute != null && !ov.isUnavailable) return [[ov.startMinute, ov.endMinute]];
    if (ov.isUnavailable && (ov.startMinute == null || ov.endMinute == null)) return [];
    if (ov.isUnavailable && ov.startMinute != null && ov.endMinute != null) {
      // Partial unavailability: subtract the blocked range from the normal windows.
      const wd = weekdayOfKey(key);
      const base = host.rules.filter((r) => r.weekday === wd).map((r) => [r.startMinute, r.endMinute] as [number, number]);
      const out: Array<[number, number]> = [];
      for (const [s, e] of base) {
        if (ov.endMinute <= s || ov.startMinute >= e) out.push([s, e]);
        else {
          if (ov.startMinute > s) out.push([s, ov.startMinute]);
          if (ov.endMinute < e) out.push([ov.endMinute, e]);
        }
      }
      return out;
    }
  }
  const wd = weekdayOfKey(key);
  return host.rules.filter((r) => r.weekday === wd).map((r) => [r.startMinute, r.endMinute]);
}

export function computeSlots(input: {
  type: TypeInput;
  hosts: HostInput[];
  now: Date;
  fromKey?: string;
  days?: number;
  weekDays?: number[];
  intervalMin?: number;
}): Map<string, Slot[]> {
  const { type, hosts, now } = input;
  const weekDays = input.weekDays ?? [1, 2, 3, 4, 5];
  const interval = input.intervalMin ?? (type.durationMin <= 20 ? 15 : 30);
  const todayKey = dubaiDateKey(now);
  const fromKey = input.fromKey && input.fromKey > todayKey ? input.fromKey : todayKey;
  const days = Math.min(input.days ?? 14, type.horizonDays + 1);
  const earliest = now.getTime() + type.minNoticeMin * 60000;
  const lastKey = addDaysKey(todayKey, type.horizonDays);
  const out = new Map<string, Slot[]>();

  for (let i = 0; i < days; i++) {
    const key = addDaysKey(fromKey, i);
    if (key > lastKey) break;
    if (!weekDays.includes(weekdayOfKey(key))) continue;
    const byStart = new Map<number, Slot>();
    for (const host of hosts) {
      if (type.dailyMax != null) {
        const count = host.busy.filter((b) => b.typeId === type.id && dubaiDateKey(b.start) === key).length;
        if (count >= type.dailyMax) continue;
      }
      for (const [ws, we] of windowsFor(host, key)) {
        const first = Math.ceil(ws / interval) * interval;
        for (let m = first; m + type.durationMin <= we; m += interval) {
          const start = dubaiInstant(key, m);
          const end = new Date(start.getTime() + type.durationMin * 60000);
          if (start.getTime() < earliest) continue;
          const guardStart = start.getTime() - type.bufferBeforeMin * 60000;
          const guardEnd = end.getTime() + type.bufferAfterMin * 60000;
          const clash = host.busy.some((b) => guardStart < b.end.getTime() && guardEnd > b.start.getTime());
          if (clash) continue;
          const existing = byStart.get(start.getTime());
          if (existing) existing.hostIds.push(host.id);
          else byStart.set(start.getTime(), { start, end, hostIds: [host.id] });
        }
      }
    }
    const list = [...byStart.values()].sort((a, b) => a.start.getTime() - b.start.getTime());
    if (list.length) out.set(key, list);
  }
  return out;
}

/** Round robin: among hosts free for the slot, pick the one with the fewest bookings in the window. */
export function pickRoundRobinHost(slot: Slot, hosts: HostInput[], typeId: string) {
  let best = slot.hostIds[0];
  let bestCount = Infinity;
  for (const id of slot.hostIds) {
    const h = hosts.find((x) => x.id === id);
    const count = h ? h.busy.filter((b) => b.typeId === typeId).length : 0;
    if (count < bestCount) {
      best = id;
      bestCount = count;
    }
  }
  return best;
}
