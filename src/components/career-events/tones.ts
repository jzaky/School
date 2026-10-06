import type { Tone } from "@/components/app/badges";

export const STATE_TONE: Record<string, Tone> = { open: "success", full: "warning", closed: "neutral", cancelled: "danger", past: "neutral" };
export const KIND_TONE: Record<string, Tone> = { UNIVERSITY_VISIT: "brand", FAIR: "violet", INFO_SESSION: "info" };
