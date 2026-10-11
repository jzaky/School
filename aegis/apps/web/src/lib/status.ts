export type Tone = "allow" | "deny" | "approval" | "info" | "critical" | "neutral";

const TONES: Record<string, Tone> = {
  // decisions and requests
  allow: "allow",
  allowed: "allow",
  approved: "allow",
  executed: "allow",
  done: "allow",
  active: "allow",
  enabled: "allow",
  valid: "allow",
  deny: "deny",
  denied: "deny",
  rejected: "deny",
  failed: "deny",
  revoked: "deny",
  disabled: "deny",
  error: "deny",
  critical: "critical",
  require_approval: "approval",
  pending_approval: "approval",
  pending: "approval",
  suspended: "approval",
  expired: "neutral",
  evaluating: "info",
  running: "info",
  investigating: "info",
  contained: "approval",
  open: "approval",
  acknowledged: "info",
  resolved: "allow",
  more_info: "approval",
  escalated: "critical",
  draft: "neutral",
  registered: "info",
  archived: "neutral",
  high: "approval",
  medium: "info",
  low: "neutral",
  development: "neutral",
  staging: "info",
  production: "allow",
};

const LABELS: Record<string, string> = {
  allow: "Allowed",
  allowed: "Allowed",
  deny: "Denied",
  denied: "Denied",
  require_approval: "Approval required",
  pending_approval: "Approval required",
  pending: "Pending",
  approved: "Approved",
  rejected: "Rejected",
  expired: "Expired",
  executed: "Executed",
  failed: "Failed",
  evaluating: "Evaluating",
  error: "Error",
  draft: "Draft",
  registered: "Registered",
  active: "Active",
  suspended: "Suspended",
  revoked: "Revoked",
  archived: "Archived",
  more_info: "More information",
  escalated: "Escalated",
  open: "Open",
  acknowledged: "Acknowledged",
  resolved: "Resolved",
  investigating: "Investigating",
  contained: "Contained",
  development: "Development",
  staging: "Staging",
  production: "Production",
  low: "Low",
  medium: "Medium",
  high: "High",
  critical: "Critical",
  public: "Public",
  internal: "Internal",
  confidential: "Confidential",
  restricted: "Restricted",
  enabled: "Enabled",
  disabled: "Disabled",
  done: "Done",
  running: "Running",
};

export function statusTone(status: string | null | undefined): Tone {
  if (!status) return "neutral";
  return TONES[status] ?? "neutral";
}

export function statusLabel(status: string | null | undefined): string {
  if (!status) return "Unknown";
  return LABELS[status] ?? status.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

export const TONE_DOT: Record<Tone, string> = {
  allow: "bg-allow",
  deny: "bg-deny",
  approval: "bg-approval",
  info: "bg-info",
  critical: "bg-critical",
  neutral: "bg-fg-dim",
};

export const TONE_TEXT: Record<Tone, string> = {
  allow: "text-allow",
  deny: "text-deny",
  approval: "text-approval",
  info: "text-info",
  critical: "text-critical",
  neutral: "text-fg-muted",
};

export const TONE_SOFT: Record<Tone, string> = {
  allow: "bg-allow/12 text-allow border-allow/30",
  deny: "bg-deny/12 text-deny border-deny/30",
  approval: "bg-approval/12 text-approval border-approval/30",
  info: "bg-info/12 text-info border-info/30",
  critical: "bg-critical/12 text-critical border-critical/30",
  neutral: "bg-bg-elev-2 text-fg-muted border-line",
};

/** Client-safe copy of the core permission check ("*" grants everything). */
export function canDo(granted: readonly string[] | undefined, needed: string): boolean {
  if (!granted) return false;
  return granted.includes("*") || granted.includes(needed);
}
