import type { Ctx } from "@/server/context";

/** Organisers manage their own trips; school leaders (calendar.manage) manage any trip. */
export function canManageTrip(ctx: Ctx, trip: { organizerId: string }) {
  return ctx.can("trips.manage") && (trip.organizerId === ctx.membershipId || ctx.can("calendar.manage"));
}
