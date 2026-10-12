import { registerDownstreamSystem } from "../simulators.js";
import { stripeTestConnector } from "./stripe.js";

export * from "./stripe.js";

let installed = false;

/** Registers the sandbox connectors with the gateway. Idempotent; call it next to installShield(). */
export function installConnectors(): void {
  registerDownstreamSystem(stripeTestConnector);
  installed = true;
}

export function areConnectorsInstalled(): boolean {
  return installed;
}
