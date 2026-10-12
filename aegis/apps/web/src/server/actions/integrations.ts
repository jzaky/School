"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withTenant } from "@aegis/db";
import { createIntegration, forbidden, integrationInputSchema, revokeCredential, rotateCredential, setIntegrationStatus, storeCredential, testIntegrationConnection, webhookSecretFor } from "@aegis/core";
import { getConsoleContext } from "@/server/session";
import { act } from "./util";

const uuid = z.string().uuid();

function revalidateIntegration(id?: string) {
  revalidatePath("/integrations");
  if (id) revalidatePath(`/integrations/${id}`);
  revalidatePath("/gateway");
}

export async function createIntegrationAction(input: unknown) {
  return act(async () => {
    const c = await getConsoleContext();
    if (!c.can("integrations:write")) throw forbidden("Missing permission integrations:write");
    const data = integrationInputSchema.parse(input);
    const r = await withTenant(c.ctx.orgId, (db) => createIntegration(db, c.ctx, { ...data, baseUrl: data.baseUrl?.trim() ? data.baseUrl.trim() : undefined }));
    revalidateIntegration(r.integration.id);
    // Shown once; only the encrypted form is stored.
    return { id: r.integration.id, webhookSecret: r.webhookSecret, key: r.integration.key };
  });
}

export async function setIntegrationStatusAction(integrationId: string, status: "active" | "disabled", reason: string) {
  return act(async () => {
    const c = await getConsoleContext();
    const id = uuid.parse(integrationId);
    const s = z.enum(["active", "disabled"]).parse(status);
    const row = await withTenant(c.ctx.orgId, (db) => setIntegrationStatus(db, c.ctx, id, s, z.string().max(1000).parse(reason ?? "")));
    revalidateIntegration(id);
    return { status: row.status };
  });
}

const credentialSchema = z.object({ name: z.string().min(2).max(80).regex(/^[a-zA-Z0-9_.-]+$/, "letters, digits, dot, underscore, hyphen"), secret: z.string().min(8).max(4000), rotationDays: z.coerce.number().int().min(1).max(3650).default(90) });

/** The downstream system may refuse the secret (for example a live Stripe key); its message is returned as the error. */
export async function storeCredentialAction(integrationId: string, input: unknown) {
  return act(async () => {
    const c = await getConsoleContext();
    const id = uuid.parse(integrationId);
    const data = credentialSchema.parse(input);
    const row = await withTenant(c.ctx.orgId, (db) => storeCredential(db, c.ctx, id, data.name, data.secret, data.rotationDays));
    revalidateIntegration(id);
    return { id: row.id, version: row.version };
  });
}

export async function rotateCredentialAction(integrationId: string, credentialId: string) {
  return act(async () => {
    const c = await getConsoleContext();
    const id = uuid.parse(integrationId);
    const row = await withTenant(c.ctx.orgId, (db) => rotateCredential(db, c.ctx, uuid.parse(credentialId)));
    revalidateIntegration(id);
    return { version: row.version, rotationDueAt: row.rotationDueAt?.toISOString() ?? null };
  });
}

export async function revokeCredentialAction(integrationId: string, credentialId: string, reason: string) {
  return act(async () => {
    const c = await getConsoleContext();
    const id = uuid.parse(integrationId);
    await withTenant(c.ctx.orgId, (db) => revokeCredential(db, c.ctx, uuid.parse(credentialId), z.string().min(3).max(1000).parse(reason)));
    revalidateIntegration(id);
  });
}

/** Reveals the webhook secret. The view is recorded as evidence by the core service. */
export async function revealWebhookSecretAction(integrationId: string) {
  return act(async () => {
    const c = await getConsoleContext();
    const id = uuid.parse(integrationId);
    const secret = await withTenant(c.ctx.orgId, (db) => webhookSecretFor(db, c.ctx, id));
    revalidateIntegration(id);
    return { secret };
  });
}

/**
 * Runs the downstream system's connection check (for Stripe: GET /v1/balance in test mode), records
 * the health flag and an evidence event. The network call runs outside any tenant transaction.
 */
export async function testIntegrationConnectionAction(integrationId: string) {
  return act(async () => {
    const c = await getConsoleContext();
    const id = uuid.parse(integrationId);
    const result = await testIntegrationConnection((fn) => withTenant(c.ctx.orgId, fn), c.ctx, id);
    revalidateIntegration(id);
    return result;
  });
}
