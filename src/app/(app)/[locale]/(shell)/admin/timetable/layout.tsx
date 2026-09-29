import { requireModule } from "@/server/onboarding/modules";

export default async function ModuleLayout({ children }: { children: React.ReactNode }) {
  await requireModule("timetable");
  return children;
}
