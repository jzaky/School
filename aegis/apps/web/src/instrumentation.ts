export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { assertApplicationProcess, initKeyring, installConnectors, installShield } = await import("@aegis/core");
    assertApplicationProcess("web");
    await initKeyring();
    installShield();
    installConnectors();
  }
}
