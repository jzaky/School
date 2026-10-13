import { registerDownstreamSystem } from "../simulators.js";
import { stripeTestConnector } from "./stripe.js";
import { alpacaPaperConnector } from "./alpaca.js";

export * from "./stripe.js";
export * from "./alpaca.js";

let installed = false;

/** Registers the sandbox connectors with the gateway. Idempotent; call it next to installShield(). */
export function installConnectors(): void {
  registerDownstreamSystem(stripeTestConnector);
  registerDownstreamSystem(alpacaPaperConnector);
  installed = true;
}

export function areConnectorsInstalled(): boolean {
  return installed;
}
