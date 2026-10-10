import { registerJobHandler } from "@aegis/core";

/** Module job handlers registered phase by phase (monitoring, notifications, document parsing). */
export function registerModuleHandlers() {
  registerJobHandler("monitoring.run", async () => {
    // Replaced by the Assurance module in phase 3.
  });
}
