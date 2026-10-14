/** Labels and tones for AI gateway decisions, shared by server and client components. */
export function decisionTone(d: string) {
  return d === "allow" ? ("allow" as const) : d === "redact" ? ("info" as const) : ("deny" as const);
}
export const DECISION_LABEL: Record<string, string> = { allow: "Allowed", redact: "Redacted", block: "Blocked" };

export const SOFTWARE_STATUS: Record<string, { label: string; tone: "allow" | "info" | "approval" | "deny" | "critical" | "neutral" }> = {
  approved: { label: "Approved", tone: "allow" },
  restricted: { label: "Restricted", tone: "info" },
  under_review: { label: "Under review", tone: "approval" },
  quarantined: { label: "Quarantined", tone: "critical" },
  prohibited: { label: "Prohibited", tone: "deny" },
};
export function severityTone(s: string) {
  return s === "critical" ? ("critical" as const) : s === "high" ? ("deny" as const) : s === "medium" ? ("approval" as const) : ("neutral" as const);
}
