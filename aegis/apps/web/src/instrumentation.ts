export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { assertApplicationProcess, installShield } = await import("@aegis/core");
    assertApplicationProcess("web");
    installShield();
  }
}
