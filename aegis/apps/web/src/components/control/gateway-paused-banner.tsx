import Link from "next/link";
import { OctagonPause } from "lucide-react";
import { getConsoleContext } from "@/server/session";

/** Prominent banner shown across the console while settings.gatewayPaused is true. */
export async function GatewayPausedBanner() {
  const c = await getConsoleContext();
  const s = c.org.settings as { gatewayPaused?: boolean; gatewayPausedReason?: string; gatewayPausedBy?: string };
  if (!s.gatewayPaused) return null;
  return (
    <div role="alert" className="mb-4 flex flex-wrap items-center gap-3 rounded-md border border-deny bg-deny/15 px-4 py-2.5 text-sm text-fg">
      <OctagonPause className="h-4 w-4 shrink-0 text-deny" aria-hidden />
      <span className="font-semibold text-deny">Action Gateway paused.</span>
      <span className="text-fg-muted">Every new agent request is denied.{s.gatewayPausedReason ? ` Reason: ${s.gatewayPausedReason}.` : ""}{s.gatewayPausedBy ? ` Paused by ${s.gatewayPausedBy}.` : ""}</span>
      {c.can("org:admin") ? (
        <Link href="/org/settings" className="ms-auto text-accent hover:underline">
          Resume from Settings
        </Link>
      ) : null}
    </div>
  );
}
