import { getConsoleContext } from "@/server/session";
import { shellDataFromContext } from "@/server/shell-data";
import { ConsoleShell } from "@/components/shell/console-shell";
import { GatewayPausedBanner } from "@/components/control/gateway-paused-banner";

export default async function ConsoleLayout({ children }: { children: React.ReactNode }) {
  const c = await getConsoleContext();
  const data = await shellDataFromContext(c);
  return (
    <ConsoleShell data={data}>
      <GatewayPausedBanner />
      {children}
    </ConsoleShell>
  );
}
