// Runs once when the web server starts. Registers the fees module with admissions (seat booking provider and the
// seat paid hook) in the Node.js runtime only, and keeps query details (personal data) out of production logs.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    if (process.env.NODE_ENV === "production") (await import("@/lib/log-redaction")).installLogRedaction();
    await import("@/server/fees/admissions-link");
  }
}
