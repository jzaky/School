import type { Tone } from "@/lib/status";

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function findingTone(s: string | null | undefined): Tone {
  switch (s) {
    case "covered":
      return "allow";
    case "partial":
      return "approval";
    case "ambiguous":
      return "info";
    case "missing":
      return "deny";
    default:
      return "neutral";
  }
}

export const FINDING_LABELS: Record<string, string> = { covered: "Covered", partial: "Partial", ambiguous: "Ambiguous", missing: "Missing" };

export function findingLabel(s: string | null | undefined): string {
  return (s && FINDING_LABELS[s]) || s || "Unknown";
}

export function conclusionText(c: "automated" | "human_validated" | string): "Automated" | "Human validated" {
  return c === "human_validated" ? "Human validated" : "Automated";
}

export function remediationTone(s: string | null | undefined): Tone {
  switch (s) {
    case "open":
      return "approval";
    case "in_progress":
      return "info";
    case "review":
      return "approval";
    case "resolved":
      return "allow";
    case "reopened":
      return "deny";
    default:
      return "neutral";
  }
}

export const REMEDIATION_LABELS: Record<string, string> = { open: "Open", in_progress: "In progress", review: "In review", resolved: "Resolved", reopened: "Reopened" };

export function remediationLabel(s: string | null | undefined): string {
  return (s && REMEDIATION_LABELS[s]) || s || "Unknown";
}

export function documentStatusTone(s: string | null | undefined): Tone {
  switch (s) {
    case "parsed":
      return "allow";
    case "parsing":
      return "info";
    case "uploaded":
      return "approval";
    case "failed":
      return "deny";
    default:
      return "neutral";
  }
}

export const DOCUMENT_TYPE_LABELS: Record<string, string> = {
  "application/pdf": "PDF",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "DOCX",
  "text/plain": "TXT",
  "text/markdown": "Markdown",
};

export const REPORT_KIND_LABELS: Record<string, string> = {
  executive_summary: "Executive summary",
  detailed: "Detailed assessment report",
  evidence_inventory: "Evidence inventory",
  gap_report: "Gap report",
  remediation_plan: "Remediation plan",
};

export const REPORT_KIND_DESCRIPTIONS: Record<string, string> = {
  executive_summary: "One page for leadership: the overall coverage figure, how many controls are covered, partial, ambiguous or missing by category, and whether the findings have been reviewed.",
  detailed: "Every control, with what was found, how confident the check was, the reasoning, a recommendation and the evidence it cites.",
  evidence_inventory: "Every piece of evidence cited: document excerpts with their page and passage (chunk), automated AEGIS references and the validations people made.",
  gap_report: "Only the controls that are partial, ambiguous or missing, with recommendations and the remediation tasks linked to them.",
  remediation_plan: "Open remediation tasks grouped by owner and due date, showing which controls each one closes.",
};

export function toDateInput(d: string | Date | null | undefined): string {
  if (!d) return "";
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toISOString().slice(0, 10);
}
