import { env, logger, startTelemetry } from "@aegis/core";
import { buildApp } from "./app.js";

const telemetry = await startTelemetry("api");

const app = await buildApp();
const port = env().API_PORT;
try {
  await app.listen({ port, host: "0.0.0.0" });
  logger.info({ port }, "aegis-api listening");
} catch (err) {
  logger.error({ err }, "failed to start api");
  process.exit(1);
}
for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, async () => {
    await app.close();
    await telemetry.shutdown();
    process.exit(0);
  });
}
