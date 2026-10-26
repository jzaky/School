// Attendance settings and the school's code list (attendance.manage or school.manage). Audited.
// Codes are never deleted, only switched off, so old marks keep their meaning and label.
import type { RegisterMode } from "@prisma/client";
import { tenantTx } from "@/lib/tenant-db";
import { audit } from "@/server/audit/audit";
import { ALL_GRADE_LEVELS } from "@/lib/grade-levels";
import { validateCodes, type CodeInput } from "./codes";
import { isHhmm, loadCodes, loadSettings, toMin } from "./settings";
import { RegisterError, type AttViewer } from "./registers";

export const canConfigure = (v: Pick<AttViewer, "isStaff" | "can">) => v.isStaff && (v.can("attendance.manage") || v.can("school.manage"));

export type SettingsInput = {
  mode: RegisterMode;
  dailyStart: string;
  lateCutoffMin: number;
  closeTime: string;
  followUpTime: string;
  autoNotify: boolean;
  persistentThreshold: number;
  persistentMinDays: number;
  dailyOnlyGrades: number[];
  headsOfYear: Record<string, string[]>;
  limitEnabled: boolean;
  limitConsecutive: number;
  limitTotal: number;
  limitWarnPct: number;
};

/** Check settings. Returns an error key (attendance.settings.error.*) or null. */
export function checkSettings(s: SettingsInput): string | null {
  if (s.mode !== "HORIZON" && s.mode !== "EXTERNAL") return "mode";
  if (!isHhmm(s.dailyStart) || !isHhmm(s.closeTime) || !isHhmm(s.followUpTime)) return "time";
  if (toMin(s.closeTime) <= toMin(s.dailyStart)) return "closeBeforeStart";
  if (toMin(s.followUpTime) <= toMin(s.dailyStart)) return "followUpBeforeStart";
  if (!Number.isInteger(s.lateCutoffMin) || s.lateCutoffMin < 0 || s.lateCutoffMin > 240) return "cutoff";
  if (!Number.isFinite(s.persistentThreshold) || s.persistentThreshold < 50 || s.persistentThreshold > 100) return "threshold";
  if (!Number.isInteger(s.persistentMinDays) || s.persistentMinDays < 1 || s.persistentMinDays > 200) return "minDays";
  if (s.dailyOnlyGrades.some((g) => !ALL_GRADE_LEVELS.includes(g))) return "grades";
  for (const [k, ids] of Object.entries(s.headsOfYear)) {
    if (!ALL_GRADE_LEVELS.includes(Number(k)) || !Array.isArray(ids) || ids.length > 5) return "heads";
  }
  if (!Number.isInteger(s.limitConsecutive) || s.limitConsecutive < 2 || s.limitConsecutive > 100) return "limit";
  if (!Number.isInteger(s.limitTotal) || s.limitTotal < 2 || s.limitTotal > 200 || s.limitTotal < s.limitConsecutive) return "limit";
  if (!Number.isInteger(s.limitWarnPct) || s.limitWarnPct < 30 || s.limitWarnPct > 95) return "limitWarn";
  return null;
}

export async function saveSettings(v: AttViewer, input: SettingsInput) {
  if (!canConfigure(v)) throw new RegisterError("forbidden");
  const err = checkSettings(input);
  if (err) throw new RegisterError(err);
  // Heads of year must be active staff of this school.
  const ids = [...new Set(Object.values(input.headsOfYear).flat())];
  if (ids.length) {
    const ok = await v.db.membership.count({ where: { id: { in: ids }, status: "ACTIVE", student: { is: null }, guardian: { is: null } } });
    if (ok !== ids.length) throw new RegisterError("heads");
  }
  const before = await loadSettings(v.db);
  const data = {
    mode: input.mode,
    dailyStart: input.dailyStart,
    lateCutoffMin: input.lateCutoffMin,
    closeTime: input.closeTime,
    followUpTime: input.followUpTime,
    autoNotify: input.autoNotify,
    persistentThreshold: input.persistentThreshold,
    persistentMinDays: input.persistentMinDays,
    dailyOnlyGrades: [...new Set(input.dailyOnlyGrades)].sort((a, b) => a - b),
    headsOfYear: Object.fromEntries(Object.entries(input.headsOfYear).filter(([, v2]) => v2.length)),
    limitEnabled: input.limitEnabled,
    limitConsecutive: input.limitConsecutive,
    limitTotal: input.limitTotal,
    limitWarnPct: input.limitWarnPct,
    updatedById: v.membershipId,
  };
  const flat: Record<string, unknown> = { ...before, limitEnabled: before.limit.enabled, limitConsecutive: before.limit.consecutive, limitTotal: before.limit.total, limitWarnPct: before.limit.warnPct };
  await tenantTx(v.orgId, async (tx) => {
    await tx.attendanceSettings.upsert({ where: { orgId: v.orgId }, create: { orgId: v.orgId, ...data }, update: data });
    const changed = (Object.keys(data) as Array<keyof typeof data>).filter((k) => k !== "updatedById" && JSON.stringify(data[k]) !== JSON.stringify(flat[k]));
    await audit(tx, v.orgId, {
      actorId: v.membershipId,
      action: "attendance.settings_update",
      entityType: "AttendanceSettings",
      meta: { changed, mode: { from: before.mode, to: data.mode }, limit: { enabled: data.limitEnabled, consecutive: data.limitConsecutive, total: data.limitTotal, warnPct: data.limitWarnPct } },
    });
  });
}

/** Replace the school's code list. Codes left out are switched off (never deleted). */
export async function saveCodes(v: AttViewer, list: CodeInput[]) {
  if (!canConfigure(v)) throw new RegisterError("forbidden");
  const clean = list.map((c, i) => ({ ...c, code: c.code.trim().toUpperCase(), labelEn: c.labelEn.trim(), labelAr: c.labelAr.trim() || c.labelEn.trim(), quick: c.quick || null, sortOrder: i }));
  const err = validateCodes(clean);
  if (err) throw new RegisterError(err);
  const { codes: before, custom } = await loadCodes(v.db);
  await tenantTx(v.orgId, async (tx) => {
    // The first save turns the built-in defaults into the school's own rows.
    if (!custom) await tx.attendanceCode.createMany({ data: before.map((c) => ({ orgId: v.orgId, ...c })), skipDuplicates: true });
    for (const c of clean) {
      const data = { labelEn: c.labelEn, labelAr: c.labelAr, countsAs: c.countsAs, authorised: c.authorised, late: c.late, category: c.category, private: c.private, quick: c.quick, active: c.active, sortOrder: c.sortOrder };
      await tx.attendanceCode.upsert({ where: { orgId_code: { orgId: v.orgId, code: c.code } }, create: { orgId: v.orgId, code: c.code, ...data }, update: data });
    }
    const kept = new Set(clean.map((c) => c.code));
    const off = before.filter((c) => !kept.has(c.code)).map((c) => c.code);
    if (off.length) await tx.attendanceCode.updateMany({ where: { orgId: v.orgId, code: { in: off } }, data: { active: false, quick: null } });
    await audit(tx, v.orgId, {
      actorId: v.membershipId,
      action: "attendance.codes_update",
      entityType: "AttendanceCode",
      meta: { codes: clean.map((c) => `${c.code}:${c.countsAs}${c.authorised ? ":auth" : ""}${c.active ? "" : ":off"}`), switchedOff: off },
    });
  });
}
