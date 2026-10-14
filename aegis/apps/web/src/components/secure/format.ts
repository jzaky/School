/** Labels and tones for AI gateway decisions, shared by server and client components. */
export function decisionTone(d: string) {
  return d === "allow" ? ("allow" as const) : d === "redact" ? ("info" as const) : ("deny" as const);
}
export const DECISION_LABEL: Record<string, string> = { allow: "Allowed", redact: "Redacted", block: "Blocked" };
