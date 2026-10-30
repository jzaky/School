import { Badge } from "@/components/ui/badge";

export type IntegrationKind = "simulated" | "sandbox";

/** Simulated systems are in-process stand-ins; sandbox connectors call a real provider in its documented test mode. */
export function integrationKind(i: { settings: unknown; baseUrl: string | null }): IntegrationKind {
  const s = (i.settings ?? {}) as { kind?: unknown; simulated?: unknown };
  if (s.kind === "sandbox" || s.simulated === false) return "sandbox";
  if (s.kind === "simulated" || s.simulated === true || i.baseUrl?.startsWith("sim://")) return "simulated";
  return "simulated";
}

export function KindBadge({ kind }: { kind: IntegrationKind }) {
  return <Badge tone={kind === "sandbox" ? "info" : "approval"}>{kind === "sandbox" ? "Sandbox" : "Simulated"}</Badge>;
}
