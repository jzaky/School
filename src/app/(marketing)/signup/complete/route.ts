import { NextResponse } from "next/server";
import { completeOAuthSignup } from "@/server/onboarding/signup-flow";

export const dynamic = "force-dynamic";

/** Landing point after a Google or Microsoft sign-up: creates the school and opens the setup wizard. */
export async function GET(req: Request) {
  const to = await completeOAuthSignup();
  return NextResponse.redirect(new URL(to, req.url));
}
