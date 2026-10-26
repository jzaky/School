import { getCtx } from "@/server/context";
import { canManageAdmissions, canSeeHealth, canViewAdmissions } from "@/server/admissions/access";
import { AdmissionsTabs } from "@/components/admissions/tabs";

export default async function AdmissionsLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getCtx();
  const tabs = canViewAdmissions(ctx)
    ? [
        "board",
        "applications",
        "waitlist",
        "capacity",
        "registration",
        "reenrollment",
        "withdrawals",
        "reports",
        ...(canSeeHealth(ctx) ? ["health"] : []),
        ...(canManageAdmissions(ctx) ? ["settings"] : []),
      ]
    : [];
  return (
    <>
      {tabs.length > 0 && <AdmissionsTabs tabs={tabs} />}
      {children}
    </>
  );
}
