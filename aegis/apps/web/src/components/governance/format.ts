import type { Tone } from "@/lib/status";

export const STAGE_TONE: Record<string, Tone> = { proposed: "neutral", evaluating: "approval", approved: "allow", deprecated: "approval", retired: "deny" };
export const RESULT_TONE: Record<string, Tone> = { pass: "allow", conditional: "approval", fail: "deny" };
export const DELETION_TONE: Record<string, Tone> = { requested: "approval", approved: "info", rejected: "neutral", completed: "allow" };
export const REG_TONE: Record<string, Tone> = { new: "info", assessing: "approval", action_required: "deny", implemented: "allow", not_applicable: "neutral" };
export const REG_LABEL: Record<string, string> = { new: "new", assessing: "assessing", action_required: "action required", implemented: "implemented", not_applicable: "not applicable" };
