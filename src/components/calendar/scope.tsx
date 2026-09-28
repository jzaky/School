"use client";

import { useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { usePathname, useRouter } from "@/i18n/navigation";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PickerCombobox, type PickerOption } from "@/components/forms/picker-combobox";

/** Choose whose calendar to view: mine, a colleague, a department or a student. */
export function CalendarScope({ staff, departments, students, isStaff }: { staff: PickerOption[]; departments: PickerOption[]; students: PickerOption[]; isStaff: boolean }) {
  const t = useTranslations("calendar");
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const mode = sp.get("staff") ? "staff" : sp.get("dept") ? "dept" : sp.get("student") ? "student" : "me";
  const go = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(sp.toString());
    for (const k of ["staff", "dept", "student"]) next.delete(k);
    for (const [k, v] of Object.entries(patch)) if (v) next.set(k, v);
    router.replace(`${pathname}?${next.toString()}`);
  };
  if (!isStaff && students.length <= 1) return null;
  const labels: Record<string, string> = { me: t("scope.me"), staff: t("scope.staff"), dept: t("scope.dept"), student: t("scope.student") };
  return (
    <div className="flex gap-2">
      <Select
        value={mode}
        onValueChange={(v) => {
          if (v === "me") go({});
          else if (v === "staff" && staff[0]) go({ staff: staff[0].value });
          else if (v === "dept" && departments[0]) go({ dept: departments[0].value });
          else if (v === "student" && students[0]) go({ student: students[0].value });
        }}
      >
        <SelectTrigger className="w-40" data-testid="cal-scope">
          <SelectValue>{labels[mode]}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="me">{labels.me}</SelectItem>
          {isStaff && <SelectItem value="staff">{labels.staff}</SelectItem>}
          {isStaff && <SelectItem value="dept">{labels.dept}</SelectItem>}
          {students.length > 0 && <SelectItem value="student">{labels.student}</SelectItem>}
        </SelectContent>
      </Select>
      {mode === "staff" && (
        <div className="w-56">
          <PickerCombobox options={staff} value={sp.get("staff") ?? ""} onChange={(v) => go({ staff: v })} />
        </div>
      )}
      {mode === "dept" && (
        <div className="w-56">
          <PickerCombobox options={departments} value={sp.get("dept") ?? ""} onChange={(v) => go({ dept: v })} />
        </div>
      )}
      {mode === "student" && (
        <div className="w-56">
          <PickerCombobox options={students} value={sp.get("student") ?? ""} onChange={(v) => go({ student: v })} />
        </div>
      )}
    </div>
  );
}
