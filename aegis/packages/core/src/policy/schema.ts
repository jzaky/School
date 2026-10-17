import { z } from "zod";

/**
 * AEGIS policy document, version 1.
 *
 * A policy is an ordered list of rules. Each rule has a condition tree over the authorization
 * input and an effect. Effects combine with deny-overrides, strictest first:
 * deny > quarantine > require_approval > request_more_information > restrict > allow; with no
 * matching rule the default is deny. A matching restrict narrows the parameters (caps, removed or
 * forced fields) and then executes; quarantine holds the request for security review; request_more_information
 * sends the request back to the agent naming the fields it must supply.
 *
 * Attribute paths address the input document (see gateway/input.ts), for example
 * "params.amount", "agent.riskTier", "resource.classification", "context.hour", "action.tool".
 */

export const operatorSchema = z.enum([
  "eq",
  "neq",
  "gt",
  "gte",
  "lt",
  "lte",
  "between",
  "in",
  "not_in",
  "contains",
  "not_contains",
  "starts_with",
  "ends_with",
  "matches",
  "exists",
  "missing",
  "domain_in",
  "domain_not_in",
  "subset_of",
  "intersects",
]);
export type Operator = z.infer<typeof operatorSchema>;

export interface Comparison {
  attr: string;
  op: Operator;
  value?: unknown;
}
export type Condition = { all: Condition[] } | { any: Condition[] } | { not: Condition } | { always: boolean } | Comparison;

export const conditionSchema: z.ZodType<Condition> = z.lazy(() =>
  z.union([
    z.object({ all: z.array(conditionSchema).min(1) }).strict(),
    z.object({ any: z.array(conditionSchema).min(1) }).strict(),
    z.object({ not: conditionSchema }).strict(),
    z.object({ always: z.boolean() }).strict(),
    z.object({ attr: z.string().min(1).max(120).regex(/^[a-zA-Z_][a-zA-Z0-9_.\-[\]]*$/), op: operatorSchema, value: z.unknown().optional() }).strict(),
  ]),
);

export const approvalRequirementSchema = z.object({
  /** Role keys allowed to decide. Empty means anyone with approvals:decide. */
  roles: z.array(z.string()).default([]),
  minApprovers: z.number().int().min(1).max(5).default(1),
  expiresInMinutes: z.number().int().min(1).max(7 * 24 * 60).default(240),
  /** Owners of the requesting agent and the requesting principal cannot approve. Default on. */
  separationOfDuties: z.boolean().default(true),
  escalateToRoles: z.array(z.string()).default([]),
  /** Shown to approvers. */
  instructions: z.string().max(500).default(""),
});
export type ApprovalRequirement = z.infer<typeof approvalRequirementSchema>;

/** Narrowing applied when a rule with effect "restrict" decides. Paths are top-level or dotted parameter names. */
export const restrictSpecSchema = z.object({
  /** Numeric parameters capped at the given value, for example { "amount": 5000 }. */
  capNumeric: z.record(z.number()).default({}),
  /** Parameters forced to a value, for example { "channel": "sandbox" }. */
  setParams: z.record(z.unknown()).default({}),
  /** Parameters removed before execution. */
  removeParams: z.array(z.string().min(1).max(80)).max(20).default([]),
  /** Shown to the agent and recorded in evidence. */
  note: z.string().max(300).default(""),
});
export type RestrictSpec = z.infer<typeof restrictSpecSchema>;

/** What the agent must supply when a rule with effect "request_more_information" decides. */
export const moreInformationSpecSchema = z.object({
  fields: z.array(z.string().min(1).max(80)).min(1).max(20),
  message: z.string().max(500).default(""),
  /** How long the request waits for the resubmission before it expires. */
  expiresInMinutes: z.number().int().min(5).max(7 * 24 * 60).default(24 * 60),
});
export type MoreInformationSpec = z.infer<typeof moreInformationSpecSchema>;

/** How a quarantined request is held and who may release it. */
export const quarantineSpecSchema = z.object({
  severity: z.enum(["low", "medium", "high", "critical"]).default("high"),
  /** Role keys that may release the request to the approval flow or refuse it. Empty means anyone with security:write. */
  reviewRoles: z.array(z.string()).default([]),
  expiresInMinutes: z.number().int().min(5).max(7 * 24 * 60).default(24 * 60),
  note: z.string().max(300).default(""),
});
export type QuarantineSpec = z.infer<typeof quarantineSpecSchema>;

export const EFFECTS = ["allow", "deny", "require_approval", "restrict", "quarantine", "request_more_information"] as const;

export const ruleSchema = z.object({
  id: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/),
  description: z.string().max(500).default(""),
  effect: z.enum(EFFECTS),
  when: conditionSchema,
  approval: approvalRequirementSchema.optional(),
  restrict: restrictSpecSchema.optional(),
  moreInformation: moreInformationSpecSchema.optional(),
  quarantine: quarantineSpecSchema.optional(),
  /** Human readable reason returned to the agent and recorded in evidence. */
  reason: z.string().max(300).default(""),
  /** Labels copied onto the action request for approvers and monitoring. */
  riskIndicators: z.array(z.string().max(60)).max(10).default([]),
  /** When set, a matching deny also raises a security event of this severity. */
  securityEventSeverity: z.enum(["low", "medium", "high", "critical"]).optional(),
});
export type Rule = z.infer<typeof ruleSchema>;

export const policyDocumentSchema = z
  .object({
    version: z.literal(1),
    /** Optional scoping: the policy only evaluates when all listed scopes match (empty = any). */
    appliesTo: z
      .object({
        tools: z.array(z.string()).default([]),
        actions: z.array(z.string()).default([]),
        environments: z.array(z.enum(["development", "staging", "production"])).default([]),
      })
      .default({ tools: [], actions: [], environments: [] }),
    rules: z.array(ruleSchema).min(1).max(200),
    /** Optional test cases evaluated when the version is submitted for review. */
    tests: z
      .array(
        z.object({
          name: z.string().max(120),
          input: z.record(z.unknown()),
          expect: z.enum(EFFECTS),
        }),
      )
      .default([]),
    /**
     * Optional metadata that does not affect evaluation. Guided templates record the settings a
     * document was generated from under `meta.template` so the console can reopen the guided form.
     */
    meta: z
      .object({
        template: z
          .object({
            id: z.string().min(1).max(64),
            settings: z.record(z.unknown()),
          })
          .optional(),
      })
      .passthrough()
      .optional(),
  })
  .superRefine((doc, ctx) => {
    const ids = new Set<string>();
    doc.rules.forEach((r, i) => {
      if (ids.has(r.id)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Duplicate rule id "${r.id}"`, path: ["rules", i, "id"] });
      ids.add(r.id);
      if (r.effect === "require_approval" && !r.approval) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Rule "${r.id}" requires approval settings`, path: ["rules", i, "approval"] });
      }
    });
  });
export type PolicyDocument = z.infer<typeof policyDocumentSchema>;

export function parsePolicyDocument(doc: unknown): PolicyDocument {
  return policyDocumentSchema.parse(doc);
}

/** Lists every attribute path a document references (for the policy editor and impact analysis). */
export function referencedAttributes(doc: PolicyDocument): string[] {
  const out = new Set<string>();
  const walk = (c: Condition) => {
    if ("all" in c) c.all.forEach(walk);
    else if ("any" in c) c.any.forEach(walk);
    else if ("not" in c) walk(c.not);
    else if ("attr" in c) out.add(c.attr);
  };
  doc.rules.forEach((r) => walk(r.when));
  return [...out].sort();
}
