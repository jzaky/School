import { z } from "zod";

/**
 * AEGIS policy document, version 1.
 *
 * A policy is an ordered list of rules. Each rule has a condition tree over the authorization
 * input and an effect. Effects combine with deny-overrides: any matching deny wins; otherwise any
 * matching require_approval wins; otherwise a matching allow permits; otherwise the default is deny.
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
    z.object({ attr: z.string().min(1).max(120).regex(/^[a-zA-Z_][a-zA-Z0-9_.\-\[\]]*$/), op: operatorSchema, value: z.unknown().optional() }).strict(),
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

export const ruleSchema = z.object({
  id: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/),
  description: z.string().max(500).default(""),
  effect: z.enum(["allow", "deny", "require_approval"]),
  when: conditionSchema,
  approval: approvalRequirementSchema.optional(),
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
          expect: z.enum(["allow", "deny", "require_approval"]),
        }),
      )
      .default([]),
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
