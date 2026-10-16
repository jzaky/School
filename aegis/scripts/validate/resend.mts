/**
 * Email through Resend with the same provider code the worker uses (packages/core/src/notify/email.ts).
 *
 *   read -rs RESEND_API_KEY && export RESEND_API_KEY
 *   AEGIS_VALIDATE_EMAIL_TO=you@example.com EMAIL_FROM="AEGIS <onboarding@resend.dev>" npx tsx scripts/validate/run.mts resend
 *
 * Sends one test message, then sends it again with the same idempotency key to show Resend does not
 * deliver it twice (same message id). EMAIL_FROM must be a sender Resend accepts for the key: a domain
 * verified in the Resend account, or onboarding@resend.dev to the account owner's own address.
 * The recipient address is never printed.
 */
import { randomUUID } from "node:crypto";
import { resendEmailProvider } from "../../packages/core/src/notify/email.js";

const line = (pass: boolean, name: string, detail: string) => console.log(`${pass ? "PASS" : "FAIL"}  ${name.padEnd(48)}  ${detail}`);
let failed = 0;
const to = process.env.AEGIS_VALIDATE_EMAIL_TO ?? "";
const provider = resendEmailProvider(process.env.RESEND_API_KEY ?? "", { baseUrl: process.env.RESEND_API_BASE ?? "https://api.resend.com", from: process.env.EMAIL_FROM });
const key = `aegis-validation-${randomUUID()}`;
const msg = { to, subject: "[AEGIS] Test email from the integration check", text: "This is a test message sent by scripts/validate/resend.mts. No action is needed.", idempotencyKey: key };
const first = await provider.send(msg);
if (first.ok) line(true, "message accepted by Resend", `id ${first.id ?? "(none returned)"}`);
else {
  failed++;
  line(false, "message accepted by Resend", first.error);
}
if (first.ok) {
  const second = await provider.send(msg);
  const same = second.ok && second.id === first.id;
  if (!same) failed++;
  line(same, "same idempotency key, same message", second.ok ? `id ${second.id ?? "(none)"}` : second.error);
}
console.log("Check the inbox: exactly one test message should arrive.");
process.exit(failed ? 1 : 0);
