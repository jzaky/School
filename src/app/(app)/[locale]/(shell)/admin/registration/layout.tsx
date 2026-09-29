import { requireModule } from "@/server/onboarding/modules";

export default async function ModuleLayout({ children }: { children: React.ReactNode }) {
  await requireModule("registration");
  return children;
}
