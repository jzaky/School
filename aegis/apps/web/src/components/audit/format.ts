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
  executive_summary: "Coverage headline, counts by status and category, and the review state. One page for leadership.",
  detailed: "Every control with its finding, confidence, rationale, recommendation and cited evidence.",
  evidence_inventory: "All cited artifacts: document excerpts with page and chunk, automated AEGIS references and human validations.",
  gap_report: "Only partial, ambiguous and missing controls, with recommendations and linked remediation tasks.",
  remediation_plan: "Open remediation tasks grouped by owner and due date, with the controls they close.",
};

export function toDateInput(d: string | Date | null | undefined): string {
  if (!d) return "";
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toISOString().slice(0, 10);
}
