import type { DeploymentComponent, DeploymentManifest } from "./manifest.js";

/**
 * Data residency assessment. AEGIS states that customer data stays in a country only when every
 * component and subprocessor that holds customer data, and the backups, are declared in that country
 * and each declaration was attested by a named person within the last year. Anything less produces an
 * explicit "no claim" statement. This is an operator declaration checked for completeness, not an
 * independent verification of the provider's infrastructure.
 */

export const ATTESTATION_MAX_AGE_DAYS = 365;

export type ComponentResidency = "in_country" | "outside" | "undeclared" | "not_attested" | "no_customer_data";

export interface ResidencyAssessment {
  country: string;
  claimAllowed: boolean;
  statement: string;
  components: { key: string; provider: string; kind: DeploymentComponent["kind"]; country: string; region: string; subprocessor: boolean; status: ComponentResidency; reason: string }[];
  backups: { status: ComponentResidency | "missing"; reason: string };
  blockers: string[];
}

export function assessResidency(m: DeploymentManifest, country: string, now = new Date()): ResidencyAssessment {
  const blockers: string[] = [];
  const fresh = (d?: Date) => !!d && now.getTime() - d.getTime() <= ATTESTATION_MAX_AGE_DAYS * 86_400_000 && d.getTime() <= now.getTime() + 86_400_000;
  const components = m.components.map((c) => {
    let status: ComponentResidency;
    let reason: string;
    if (!c.holdsCustomerData) {
      status = "no_customer_data";
      reason = "Declared to hold no customer data";
    } else if (c.country === "unknown") {
      status = "undeclared";
      reason = "Country not declared";
    } else if (c.country !== country) {
      status = "outside";
      reason = `Declared in ${c.country}`;
    } else if (!c.attestedBy || !fresh(c.attestedAt)) {
      status = "not_attested";
      reason = c.attestedAt ? `Attestation older than ${ATTESTATION_MAX_AGE_DAYS} days` : "No named attestation with a date";
    } else {
      status = "in_country";
      reason = `Attested by ${c.attestedBy}`;
    }
    if (status !== "in_country" && status !== "no_customer_data") blockers.push(`${c.provider} (${c.key}): ${reason.toLowerCase()}`);
    return { key: c.key, provider: c.provider, kind: c.kind, country: c.country, region: c.region, subprocessor: c.subprocessor, status, reason };
  });
  const required: DeploymentComponent["kind"][] = ["hosting", "database"];
  for (const k of required) if (!m.components.some((c) => c.kind === k && c.holdsCustomerData)) blockers.push(`No ${k} component declared`);
  let backups: ResidencyAssessment["backups"];
  if (!m.backups) {
    backups = { status: "missing", reason: "No backup arrangement declared" };
    blockers.push("Backups: none declared");
  } else if (m.backups.country === "unknown") {
    backups = { status: "undeclared", reason: "Backup country not declared" };
    blockers.push("Backups: country not declared");
  } else if (m.backups.country !== country) {
    backups = { status: "outside", reason: `Backups declared in ${m.backups.country}` };
    blockers.push(`Backups: declared in ${m.backups.country}`);
  } else backups = { status: "in_country", reason: `Backups declared in ${country}` };
  if (m.model === "development") blockers.push("This is a development installation");
  const claimAllowed = blockers.length === 0;
  const statement = claimAllowed
    ? `The operator has declared and attested that every component and subprocessor holding customer data, and the backups, are in ${country}. This is the operator's declaration, not an independent audit.`
    : `AEGIS makes no ${country} data residency claim for this installation: ${blockers.length} item${blockers.length === 1 ? "" : "s"} prevent it.`;
  return { country, claimAllowed, statement, components, backups, blockers };
}
