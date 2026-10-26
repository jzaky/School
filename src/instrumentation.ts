// Runs once when the web server starts. Registers the fees module with admissions (seat booking provider and the
// seat paid hook) in the Node.js runtime only.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") await import("@/server/fees/admissions-link");
}
