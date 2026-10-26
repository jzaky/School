import { getTranslations } from "next-intl/server";
import type { Ctx } from "@/server/context";
import { AccessTabs } from "@/components/access/access-tabs";
import { attViewer, canManage, canTakeAny } from "@/server/attendance/registers";
import { canConfigure } from "@/server/attendance/admin";

export type AttendanceTab = "today" | "office" | "reports" | "settings";

/** Which attendance pages the member may open. */
export function attendanceAccess(ctx: Ctx) {
  const v = attViewer(ctx);
  return {
    today: canTakeAny(v) || canManage(v),
    office: canManage(v),
    reports: ctx.isStaff && (ctx.can("attendance.view_all") || canManage(v) || canTakeAny(v)),
    settings: canConfigure(v),
  };
}

export async function AttendanceTabs({ ctx, current, counts }: { ctx: Ctx; current: AttendanceTab; counts?: { office?: number } }) {
  const t = await getTranslations("attendance.tabs");
  const a = attendanceAccess(ctx);
  const tabs = [
    ...(a.today ? [{ value: "today", label: t("today"), href: "/attendance" }] : []),
    ...(a.office ? [{ value: "office", label: t("office"), href: "/attendance/office", count: counts?.office }] : []),
    ...(a.reports ? [{ value: "reports", label: t("reports"), href: "/attendance/reports" }] : []),
    ...(a.settings ? [{ value: "settings", label: t("settings"), href: "/attendance/settings" }] : []),
  ];
  if (tabs.length < 2) return null;
  return <AccessTabs current={current} tabs={tabs} label={t("label")} />;
}
