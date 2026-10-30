import { requirePlatformAdmin } from "@/server/session";
import { shellDataForPlatform } from "@/server/shell-data";
import { ConsoleShell } from "@/components/shell/console-shell";

export default async function PlatformLayout({ children }: { children: React.ReactNode }) {
  const s = await requirePlatformAdmin();
  const data = await shellDataForPlatform(s);
  return <ConsoleShell data={data}>{children}</ConsoleShell>;
}
