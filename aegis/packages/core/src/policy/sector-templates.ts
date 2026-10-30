import { z } from "zod";
import { parsePolicyDocument, type PolicyDocument } from "./schema.js";

/**
 * Sector policy templates (docs/POLICY_LANGUAGE.md, "Templates"). Each builds an ordinary policy
 * document with embedded tests from a few settings; the result is reviewed, tested and activated like
 * any other policy. They are starting points with illustrative defaults, not legal or regulatory advice.
 */

const SECRET_CLASSES = ["api_key", "jwt", "private_key", "password_assignment"];
const PERSONAL_CLASSES = ["email", "phone", "emirates_id", "iban", "card_number"];

const base = z.object({ tools: z.array(z.string().min(1).max(80)).min(1).max(50) });
export const sectorTemplateSettings = {
  "secrets-publishing-guard": base,
  "personal-data-egress": base.extend({ approvedDomains: z.array(z.string().min(3).max(253)).max(50).default([]) }),
  "health-records-minimum-necessary": base.extend({ maxRecords: z.number().int().min(1).max(100_000).default(25), approverRoles: z.array(z.string()).min(1).default(["governance_manager"]), approvedDomains: z.array(z.string().min(3).max(253)).max(50).default([]) }),
  "employee-data-access": base.extend({ approverRoles: z.array(z.string()).min(1).default(["owner"]), businessHours: z.object({ start: z.number().int().min(0).max(23), end: z.number().int().min(1).max(24) }).default({ start: 4, end: 14 }) }),
  "public-information-only": base.extend({ approverRoles: z.array(z.string()).min(1).default(["governance_manager"]) }),
} as const;
export type SectorTemplateId = keyof typeof sectorTemplateSettings;

export const SECTOR_TEMPLATES: { id: SectorTemplateId; name: string; sector: string; summary: string }[] = [
  { id: "secrets-publishing-guard", name: "Secrets publishing guard", sector: "Software and engineering", summary: "Refuses any publishing or messaging action whose parameters contain credentials (API keys, tokens, private keys, passwords) and raises a high security event." },
  { id: "personal-data-egress", name: "Personal data egress", sector: "Any sector handling customer data", summary: "Refuses sending personal data (email, phone, Emirates ID, IBAN, card numbers) to destinations outside an approved list." },
  { id: "health-records-minimum-necessary", name: "Health records, minimum necessary", sector: "Healthcare", summary: "Holds requests touching more than a set number of patient records for approval and refuses health data to unapproved destinations." },
  { id: "employee-data-access", name: "Employee data access", sector: "Human resources", summary: "Requires approval for access to employee records and refuses it outside business hours." },
  { id: "public-information-only", name: "Public information only", sector: "Any sector adopting AI tools", summary: "Lets approved tools act on public resources without review and sends anything classified higher to a person." },
];

const approval = (roles: string[], instructions: string) => ({ roles, minApprovers: 1, expiresInMinutes: 240, separationOfDuties: true, escalateToRoles: [], instructions });

export function buildSectorTemplate(id: SectorTemplateId, rawSettings: unknown): PolicyDocument {
  const meta = { template: { id: `sector:${id}`, settings: rawSettings as Record<string, unknown> } };
  const tool = (s: { tools: string[] }) => s.tools[0]!;
  switch (id) {
    case "secrets-publishing-guard": {
      const s = sectorTemplateSettings[id].parse(rawSettings);
      return parsePolicyDocument({
        version: 1,
        appliesTo: { tools: s.tools, actions: [], environments: [] },
        rules: [
          { id: "no-credentials", description: "Parameters contain credentials", effect: "deny", when: { attr: "shield.dataClasses", op: "intersects", value: SECRET_CLASSES }, reason: "Credentials must never be published or sent", riskIndicators: ["credential_exposure"], securityEventSeverity: "high" },
          { id: "otherwise-allow", description: "No credentials found", effect: "allow", when: { always: true }, reason: "No credentials in the parameters" },
        ],
        tests: [
          { name: "API key is refused", input: { action: { tool: tool(s), name: "execute" }, shield: { dataClasses: ["api_key"] } }, expect: "deny" },
          { name: "clean content is allowed", input: { action: { tool: tool(s), name: "execute" }, shield: { dataClasses: [] } }, expect: "allow" },
        ],
        meta,
      });
    }
    case "personal-data-egress": {
      const s = sectorTemplateSettings[id].parse(rawSettings);
      return parsePolicyDocument({
        version: 1,
        appliesTo: { tools: s.tools, actions: [], environments: [] },
        rules: [
          { id: "personal-data-unapproved-destination", description: "Personal data to an unapproved destination", effect: "deny", when: { all: [{ attr: "shield.dataClasses", op: "intersects", value: PERSONAL_CLASSES }, { any: [{ attr: "context.destinationDomain", op: "missing" }, { attr: "context.destinationDomain", op: "domain_not_in", value: s.approvedDomains.length ? s.approvedDomains : ["approved.invalid"] }] }] }, reason: "Personal data may only go to approved destinations", riskIndicators: ["personal_data_egress"], securityEventSeverity: "high" },
          { id: "otherwise-allow", description: "Everything else", effect: "allow", when: { always: true }, reason: "No personal data leaving to an unapproved destination" },
        ],
        tests: [
          { name: "email to unknown domain refused", input: { action: { tool: tool(s), name: "execute" }, shield: { dataClasses: ["email"] }, context: { destinationDomain: "unknown.example" } }, expect: "deny" },
          { name: "no personal data allowed", input: { action: { tool: tool(s), name: "execute" }, shield: { dataClasses: [] }, context: { destinationDomain: "unknown.example" } }, expect: "allow" },
          ...(s.approvedDomains[0] ? [{ name: "approved destination allowed", input: { action: { tool: tool(s), name: "execute" }, shield: { dataClasses: ["email"] }, context: { destinationDomain: s.approvedDomains[0].replace(/^\*\./, "") } }, expect: "allow" as const }] : []),
        ],
        meta,
      });
    }
    case "health-records-minimum-necessary": {
      const s = sectorTemplateSettings[id].parse(rawSettings);
      return parsePolicyDocument({
        version: 1,
        appliesTo: { tools: s.tools, actions: [], environments: [] },
        rules: [
          { id: "unapproved-destination", description: "Health data to an unapproved destination", effect: "deny", when: { all: [{ attr: "context.destinationDomain", op: "exists" }, { attr: "context.destinationDomain", op: "domain_not_in", value: s.approvedDomains.length ? s.approvedDomains : ["approved.invalid"] }] }, reason: "Health records may only go to approved destinations", riskIndicators: ["health_data_egress"], securityEventSeverity: "high" },
          { id: "bulk-records", description: `More than ${s.maxRecords} records`, effect: "require_approval", when: { attr: "params.recordCount", op: "gt", value: s.maxRecords }, approval: approval(s.approverRoles, "Confirm that this many patient records are necessary for the purpose"), reason: `More than ${s.maxRecords} records need a person (minimum necessary)`, riskIndicators: ["bulk_health_records"] },
          { id: "within-minimum", description: "Within the minimum necessary", effect: "allow", when: { attr: "params.recordCount", op: "lte", value: s.maxRecords }, reason: "Within the minimum necessary" },
        ],
        tests: [
          { name: "small lookup allowed", input: { action: { tool: tool(s), name: "execute" }, params: { recordCount: 1 }, context: { destinationDomain: null } }, expect: "allow" },
          { name: "bulk export held", input: { action: { tool: tool(s), name: "execute" }, params: { recordCount: s.maxRecords + 1 }, context: { destinationDomain: null } }, expect: "require_approval" },
          { name: "missing count is not allowed", input: { action: { tool: tool(s), name: "execute" }, params: {}, context: { destinationDomain: null } }, expect: "deny" },
        ],
        meta,
      });
    }
    case "employee-data-access": {
      const s = sectorTemplateSettings[id].parse(rawSettings);
      return parsePolicyDocument({
        version: 1,
        appliesTo: { tools: s.tools, actions: [], environments: [] },
        rules: [
          { id: "outside-hours", description: "Outside business hours (UTC)", effect: "deny", when: { any: [{ attr: "context.hour", op: "lt", value: s.businessHours.start }, { attr: "context.hour", op: "gte", value: s.businessHours.end }] }, reason: "Employee records are not accessed outside business hours", riskIndicators: ["after_hours"] },
          { id: "needs-approval", description: "Every access needs a person", effect: "require_approval", when: { always: true }, approval: approval(s.approverRoles, "Confirm the purpose of accessing this employee record"), reason: "Access to employee records needs approval", riskIndicators: ["employee_data"] },
        ],
        tests: [
          { name: "business hours needs approval", input: { action: { tool: tool(s), name: "execute" }, context: { hour: s.businessHours.start } }, expect: "require_approval" },
          { name: "night access refused", input: { action: { tool: tool(s), name: "execute" }, context: { hour: (s.businessHours.end + 1) % 24 } }, expect: "deny" },
        ],
        meta,
      });
    }
    case "public-information-only": {
      const s = sectorTemplateSettings[id].parse(rawSettings);
      return parsePolicyDocument({
        version: 1,
        appliesTo: { tools: s.tools, actions: [], environments: [] },
        rules: [
          { id: "public-allowed", description: "Public resources", effect: "allow", when: { attr: "resource.classification", op: "eq", value: "public" }, reason: "Public information needs no review" },
          { id: "classified-needs-review", description: "Anything not public", effect: "require_approval", when: { not: { attr: "resource.classification", op: "eq", value: "public" } }, approval: approval(s.approverRoles, "The request touches non-public information"), reason: "Non-public information needs a person", riskIndicators: ["non_public_data"] },
        ],
        tests: [
          { name: "public allowed", input: { action: { tool: tool(s), name: "execute" }, resource: { classification: "public" } }, expect: "allow" },
          { name: "internal held", input: { action: { tool: tool(s), name: "execute" }, resource: { classification: "internal" } }, expect: "require_approval" },
          { name: "no resource held", input: { action: { tool: tool(s), name: "execute" }, resource: null }, expect: "require_approval" },
        ],
        meta,
      });
    }
  }
}
