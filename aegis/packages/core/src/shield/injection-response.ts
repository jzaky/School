import { orgSettings } from "../lib/tx-cache.js";
import type { Prisma, TenantDb } from "@aegis/db";
import { z } from "zod";
import { appendEvidence } from "../evidence/ledger.js";
import type { OrgContext } from "../lib/context.js";
import { assertPermission } from "../orgs/orgs.js";
import type { InjectionSignalKey } from "./injection.js";

/**
 * What the gateway does when Shield's heuristic detector finds injection signals in a request's
 * parameters. Off by default: the signals are always recorded and available to policies as
 * shield.injectionSignals, and this setting adds an organization-wide response on top.
 *
 * The response can only make an outcome stricter (allow < restrict < require_approval <
 * request_more_information < quarantine < deny). It never loosens a decision.
 * The detector is pattern-based and labelled heuristic: it can miss attacks and flag honest text.
 */
export const INJECTION_RESPONSES = ["off", "require_approval", "quarantine", "deny"] as const;
export type InjectionResponse = (typeof INJECTION_RESPONSES)[number];

export const injectionResponseSchema = z.object({
  response: z.enum(INJECTION_RESPONSES),
  /** Signal kinds that trigger the response. Empty means every kind. */
  signals: z.array(z.enum(["instruction_override", "role_hijack", "exfiltration_request", "tool_coercion", "hidden_text", "encoded_payload", "urgency_pressure"])).max(7).default([]),
});
export type InjectionResponseSetting = z.infer<typeof injectionResponseSchema>;

const OFF: InjectionResponseSetting = { response: "off", signals: [] };
const RANK: Record<string, number> = { allow: 0, restrict: 1, require_approval: 2, request_more_information: 3, quarantine: 4, deny: 5, error: 5 };

export function readInjectionResponse(settings: unknown): InjectionResponseSetting {
  const parsed = injectionResponseSchema.safeParse((settings as { shield?: { injection?: unknown } } | null)?.shield?.injection);
  return parsed.success ? parsed.data : OFF;
}

export async function getInjectionResponse(db: TenantDb, orgId: string): Promise<InjectionResponseSetting> {
  const org = { settings: await orgSettings(db, orgId) };
  return readInjectionResponse(org?.settings);
}

/** The stricter of the current outcome and the configured response, when a triggering signal is present. */
export function escalateForInjection<T extends string>(outcome: T, setting: InjectionResponseSetting, signals: readonly string[]): { outcome: T | InjectionResponse; escalated: boolean; triggering: string[] } {
  if (setting.response === "off") return { outcome, escalated: false, triggering: [] };
  const triggering = signals.filter((s) => setting.signals.length === 0 || setting.signals.includes(s as InjectionSignalKey));
  if (triggering.length === 0) return { outcome, escalated: false, triggering: [] };
  if ((RANK[setting.response] ?? 0) <= (RANK[outcome] ?? 5)) return { outcome, escalated: false, triggering };
  return { outcome: setting.response, escalated: true, triggering };
}

export async function updateInjectionResponse(db: TenantDb, ctx: OrgContext, input: z.input<typeof injectionResponseSchema>): Promise<InjectionResponseSetting> {
  assertPermission(ctx, "security:write");
  const data = injectionResponseSchema.parse(input);
  const org = await db.organization.findUniqueOrThrow({ where: { id: ctx.orgId }, select: { settings: true } });
  const settings = (org.settings ?? {}) as Record<string, unknown>;
  const shield = { ...((settings.shield ?? {}) as Record<string, unknown>), injection: data };
  await db.organization.update({ where: { id: ctx.orgId }, data: { settings: { ...settings, shield } as Prisma.InputJsonValue } });
  await appendEvidence(db, ctx, { type: "shield.injection_response_changed", subjectType: "organization", subjectId: ctx.orgId, payload: { ...data } });
  return data;
}
