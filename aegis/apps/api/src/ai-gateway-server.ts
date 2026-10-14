import { assertApplicationProcess, env, installShield, logger, startTelemetry } from "@aegis/core";
import { buildApp } from "./app.js";

/**
 * The AI gateway as its own process. It holds no routes but health and /v1/ai, so a fault or load in
 * forwarding to model providers cannot take down approvals, policies or the action gateway.
 */
assertApplicationProcess("api");

const telemetry = await startTelemetry("ai-gateway");
installShield();

const app = await buildApp({ modules: "ai-gateway" });
const port = env().AI_GATEWAY_PORT;
try {
  await app.listen({ port, host: "0.0.0.0" });
  logger.info({ port }, "aegis-ai-gateway listening");
} catch (err) {
  logger.error({ err }, "failed to start the AI gateway");
  process.exit(1);
}
for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, async () => {
    await app.close();
    await telemetry.shutdown();
    process.exit(0);
  });
}
