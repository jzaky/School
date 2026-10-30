/**
 * AI gateway against a real OpenAI-compatible provider (docs/INTEGRATION_VALIDATION.md).
 *
 *   AEGIS_VALIDATE_AI_BASE_URL=https://api.openai.com/v1 AEGIS_VALIDATE_AI_KEY=... AEGIS_VALIDATE_AI_MODEL=gpt-4o-mini \
 *     npx tsx scripts/validate/run.mts ai
 *
 * Creates a temporary organization in the local database, registers the provider with the key in the vault,
 * sends four requests through the real gateway code and deletes the organization afterwards. Prompts are
 * synthetic. Cost: three short completions on the provider account (well under one US cent with small models).
 */
import { disconnectAll, ownerPrisma, rawPrisma, withTenant, type TenantDb } from "../../packages/db/src/index.js";
import { env } from "../../packages/core/src/env.js";
import { registerUser } from "../../packages/core/src/identity/auth.js";
import { createOrganization } from "../../packages/core/src/orgs/orgs.js";
import { listUserMemberships } from "../../packages/core/src/identity/memberships.js";
import { makeContext } from "../../packages/core/src/lib/context.js";
import { completeAiRequest, createAiProvider, defaultAiSender, prepareAiRequest, setAiUpstreamSender } from "../../packages/core/src/secure/ai-gateway.js";

env();
const base = process.env.AEGIS_VALIDATE_AI_BASE_URL!.replace(/\/$/, "");
const key = process.env.AEGIS_VALIDATE_AI_KEY!;
const model = process.env.AEGIS_VALIDATE_AI_MODEL!;
const seen: string[] = [];
setAiUpstreamSender(async (req) => {
  seen.push(req.body);
  return defaultAiSender(req);
});
const stamp = `aivalidate-${Date.now().toString(36)}`;
const user = await registerUser({ email: `${stamp}@validation.aegis.local`, name: "AI validation", password: `V-${Date.now()}-Aa1!x` });
const org = await createOrganization({ name: `AI validation ${stamp}`, slug: stamp, ownerUserId: user.id });
const m = (await listUserMemberships(user.id)).find((x) => x.orgId === org.id)!;
const ctx = makeContext(org.id, { type: "user", id: user.id, permissions: m.permissions, membershipId: m.membershipId });
const run = <T>(fn: (db: TenantDb) => Promise<T>) => withTenant(org.id, fn);
const send = async (content: string, mdl = model) => {
  const p = await run((db) => prepareAiRequest(db, ctx, { type: "user", id: user.id, apiKeyId: null }, { model: mdl, messages: [{ role: "user", content }] }));
  return completeAiRequest(run, ctx, p);
};
const line = (pass: boolean, name: string, detail: string) => console.log(`${pass ? "PASS" : "FAIL"}  ${name.padEnd(52)}  ${detail}`);
let failed = 0;
const check = (pass: boolean, name: string, detail: string) => {
  if (!pass) failed++;
  line(pass, name, detail);
};
try {
  await run((db) => createAiProvider(db, ctx, { key: "validation-provider", name: "Validation provider", baseUrl: base, models: [model], apiKey: key }));
  const ok = await send("Reply with the single word: ready");
  const answer = (ok.body as { choices?: { message?: { content?: string } }[] }).choices?.[0]?.message?.content ?? "";
  check(ok.status === 200 && ok.forwarded, "clean prompt forwarded and answered", `HTTP ${ok.status}, ${answer.length} characters answered`);
  const before = seen.length;
  const masked = await send("Write one sentence greeting amira.saleh@example.com.");
  const body = seen.slice(before).join("");
  check(masked.forwarded && !body.includes("amira.saleh@example.com"), "email masked before it reached the provider", `decision ${masked.decision}, provider received the masked value`);
  const n = seen.length;
  const blocked = await send("Card 4111 1111 1111 1111 was declined, why?");
  check(blocked.status === 403 && seen.length === n, "payment card blocked, provider never contacted", `HTTP ${blocked.status}, upstream requests ${seen.length - n}`);
  const unapproved = await send("hello", `${model}-not-approved`);
  check(unapproved.status === 403 && seen.length === n, "unapproved model refused before any call", `HTTP ${unapproved.status}`);
  const events = await run((db) => db.aiGatewayEvent.findMany({ where: { orgId: org.id } }));
  check(events.length === 4 && !JSON.stringify(events).includes("amira.saleh"), "four records, none holding prompt text", `${events.length} records`);
} catch (e) {
  failed++;
  line(false, "run", e instanceof Error ? e.message : String(e));
} finally {
  await ownerPrisma().organization.delete({ where: { id: org.id } }).catch(() => undefined);
  await rawPrisma().user.delete({ where: { id: user.id } }).catch(() => undefined);
  await disconnectAll();
}
process.exit(failed ? 1 : 0);
