import type { Tone } from "@/components/app/badges";

/** Badge tone per roster run status. */
export const RUN_TONE: Record<string, Tone> = { QUEUED: "info", FETCHING: "info", PLANNING: "info", APPLYING: "info", PREVIEWED: "brand", SUCCEEDED: "success", PARTIAL: "warning", FAILED: "danger", BLOCKED: "danger", EXPIRED: "neutral" };
