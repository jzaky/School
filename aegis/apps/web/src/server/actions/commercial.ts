"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { withTenant } from "@aegis/db";
import {
  createSupportRequest,
  findSalesDemo,
  forbidden,
  platformCreateOrganization,
  platformDraftInvoice,
  platformInvoiceAction,
  platformSetContract,
  platformSetPlan,
  platformUpdateSupportRequest,
  runSalesScenario,
  SALES_SCENARIOS,
  setSessionOrg,
  setupSalesDemo,
  type SalesRun,
} from "@aegis/core";
import { getConsoleContext, requirePlatformAdmin } from "@/server/session";
import { act } from "./util";

const uuid = z.string().uuid();

// ---------- customers' own actions ----------

export async function createSupportRequestAction(input: unknown) {
  return act(async () => {
    const c = await getConsoleContext();
    const row = await withTenant(c.ctx.orgId, (db) => createSupportRequest(db, c.ctx, input as never));
    revalidatePath("/org/support");
    return { id: row.id };
  });
}

// ---------- sales demonstration ----------

/** Creates the signed-in person's sales demonstration organization and switches to it. */
export async function setupSalesDemoAction() {
  const result = await act(async () => {
    const c = await getConsoleContext();
    if (!c.org.demoMode && !c.session.user.isPlatformAdmin) throw forbidden("Sales demonstrations can be created from a demo organization or by a platform administrator");
    const org = await setupSalesDemo(c.session.user.id);
    await setSessionOrg(c.session.id, org.id);
    return { orgId: org.id };
  });
  if (result.ok) redirect("/sales-demo");
  return result;
}

export async function openSalesDemoAction() {
  const c = await getConsoleContext();
  const org = await findSalesDemo(c.session.user.id);
  if (!org) return { ok: false as const, error: "No sales demonstration environment yet" };
  await setSessionOrg(c.session.id, org.id);
  redirect("/sales-demo");
}

export async function runSalesScenarioAction(key: unknown) {
  return act(async (): Promise<SalesRun> => {
    const c = await getConsoleContext();
    if (!c.can("gateway:read")) throw forbidden("Missing permission gateway:read");
    const k = z.enum(SALES_SCENARIOS.map((s) => s.key) as [string, ...string[]]).parse(key) as SalesRun["scenario"];
    const run = await runSalesScenario(c.ctx.orgId, c.ctx, k);
    for (const p of ["/gateway", "/approvals", "/activity", "/overview", "/agents"]) revalidatePath(p);
    return run;
  });
}

// ---------- platform administrators ----------

export async function createCustomerAction(input: unknown) {
  return act(async () => {
    const s = await requirePlatformAdmin();
    const { org, invitationToken } = await platformCreateOrganization(s.user.id, input as never);
    revalidatePath("/platform/tenants");
    revalidatePath("/platform/customers");
    return { orgId: org.id, slug: org.slug, invitePath: `/invite/${invitationToken}` };
  });
}

export async function setPlanAction(orgId: unknown, input: unknown) {
  return act(async () => {
    const s = await requirePlatformAdmin();
    const id = uuid.parse(orgId);
    await platformSetPlan(s.user.id, id, input);
    revalidatePath(`/platform/customers/${id}`);
  });
}

export async function setContractAction(orgId: unknown, input: unknown) {
  return act(async () => {
    const s = await requirePlatformAdmin();
    const id = uuid.parse(orgId);
    await platformSetContract(s.user.id, id, input);
    revalidatePath(`/platform/customers/${id}`);
  });
}

export async function draftInvoiceAction(orgId: unknown, period: unknown) {
  return act(async () => {
    const s = await requirePlatformAdmin();
    const id = uuid.parse(orgId);
    const inv = await platformDraftInvoice(s.user.id, id, { period: z.string().regex(/^\d{4}-\d{2}$/).parse(period) });
    revalidatePath(`/platform/customers/${id}`);
    return { number: inv.number };
  });
}

export async function invoiceAction(orgId: unknown, invoiceId: unknown, input: unknown) {
  return act(async () => {
    const s = await requirePlatformAdmin();
    const id = uuid.parse(orgId);
    await platformInvoiceAction(s.user.id, id, uuid.parse(invoiceId), input as never);
    revalidatePath(`/platform/customers/${id}`);
  });
}

export async function updateSupportAction(orgId: unknown, requestId: unknown, input: unknown) {
  return act(async () => {
    const s = await requirePlatformAdmin();
    const id = uuid.parse(orgId);
    await platformUpdateSupportRequest(s.user.id, id, uuid.parse(requestId), input as never);
    revalidatePath(`/platform/customers/${id}`);
    revalidatePath("/platform/support");
  });
}
