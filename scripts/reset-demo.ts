// CLI: npm run db:reset-demo. Restores the demo school (owner role, MIGRATION_DATABASE_URL).
import { runDemoResetCore } from "../src/server/demo/run-reset";

runDemoResetCore()
  .then((res) => console.log(`[reset-demo] done in ${res.ms}ms`))
  .catch((e) => {
    console.error("[reset-demo] failed", e instanceof Error ? e.message : e);
    process.exit(1);
  });
