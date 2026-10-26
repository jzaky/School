// Wires fees into admissions (src/server/admissions/seat-booking.ts): fees is the seat booking provider, and a paid
// seat booking invoice moves the application to "Seat booking paid" through markSeatPaid (which runs once per
// application). Admissions only uses the provider when FEES_SEAT_BOOKING is "on". Loaded at start-up by
// src/instrumentation.ts (web) and src/worker/index.ts.
import { markSeatPaid, registerSeatBookingProvider } from "@/server/admissions/seat-booking";
import { registerSeatPaidHandler } from "./hooks";
import { feesSeatBookingProvider } from "./seat-booking";

registerSeatBookingProvider(feesSeatBookingProvider);
registerSeatPaidHandler((ec, input) => markSeatPaid(ec, { applicationId: input.applicationId, reference: input.reference, actor: null, source: "fees" }));
