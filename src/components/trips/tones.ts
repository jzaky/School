import type { TripConsent, TripStatus } from "@prisma/client";
import type { Tone } from "@/components/app/badges";

export const STATUS_TONE: Record<TripStatus, Tone> = { DRAFT: "neutral", PUBLISHED: "brand", CANCELLED: "danger", COMPLETED: "success" };
export const CONSENT_TONE: Record<TripConsent, Tone> = { PENDING: "warning", GRANTED: "success", DECLINED: "danger" };
