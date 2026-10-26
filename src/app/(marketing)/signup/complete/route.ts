import { redirectTo } from "@/lib/redirect";
import { completeOAuthSignup } from "@/server/onboarding/signup-flow";

export const dynamic = "force-dynamic";

/** Landing point after a Google or Microsoft sign-up: creates the school and opens the setup wizard. */
export async function GET() {
  const to = await completeOAuthSignup();
  return redirectTo(to);
}
