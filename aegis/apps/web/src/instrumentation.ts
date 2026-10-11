export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { installShield } = await import("@aegis/core");
    installShield();
  }
}
