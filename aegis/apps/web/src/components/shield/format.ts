import type { Tone } from "@/lib/status";

export function severityTone(s: string | null | undefined): Tone {
  switch (s) {
    case "critical":
      return "critical";
    case "high":
      return "deny";
    case "medium":
      return "approval";
    case "low":
      return "neutral";
    default:
      return "neutral";
  }
}

export function eventStatusTone(s: string | null | undefined): Tone {
  switch (s) {
    case "open":
      return "approval";
    case "triaged":
      return "info";
    case "dismissed":
      return "neutral";
    case "linked":
      return "critical";
    default:
      return "neutral";
  }
}

export function eventStatusLabel(s: string | null | undefined): string {
  switch (s) {
    case "open":
      return "Open";
    case "triaged":
      return "Triaged";
    case "dismissed":
      return "Dismissed";
    case "linked":
      return "Linked to incident";
    default:
      return s ?? "Unknown";
  }
}

export function dataActionTone(a: string): Tone {
  switch (a) {
    case "allow":
      return "neutral";
    case "mask":
      return "info";
    case "redact":
      return "approval";
    case "block":
      return "deny";
    case "require_approval":
      return "approval";
    default:
      return "neutral";
  }
}

export const DATA_ACTION_LABELS: Record<string, string> = { allow: "Allow", mask: "Mask", redact: "Redact", block: "Block", require_approval: "Require approval" };

export function pretty(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}
