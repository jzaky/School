import { rawPrisma, withTenant } from "@aegis/db";
import { logger, registerJobHandler, runMonitoring, systemContext } from "@aegis/core";

const log = logger.child({ component: "worker" });

/** Module job handlers registered phase by phase. */
export function registerModuleHandlers() {
  registerJobHandler("monitoring.run", async () => {
    const orgs = await rawPrisma().organization.findMany({ select: { id: true } });
    for (const o of orgs) {
      const r = await withTenant(o.id, (db) => runMonitoring(db, systemContext(o.id)), { timeout: 60_000 });
      if (r.newAlerts || r.errors.length) log.info({ orgId: o.id, ...r }, "monitoring run");
    }
  });
}
