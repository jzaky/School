import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, type IncomingMessage, type Server } from "node:http";
import { disconnectAll, withTenant } from "@aegis/db";
import { addUserWithRole, makeTestTenant, type TestTenant } from "./helpers.js";
import { env } from "../src/env.js";
import { makeContext } from "../src/lib/context.js";
import { signWebhook } from "../src/integrations/service.js";
import { createSecurityEvent } from "../src/shield/security-events.js";
import {
  assertSafeDestinationUrl,
  buildRequest,
  createDestination,
  dispatchEvents,
  getDestination,
  isPrivateAddress,
  listDestinations,
  retryDelivery,
  sendTestEvent,
  updateDestination,
  type EventEnvelope,
} from "../src/integrations/destinations.js";

const sample: EventEnvelope = {
  id: "evt-1",
  type: "security_event.created",
  category: "security",
  occurredAt: "2026-10-14T08:00:00.000Z",
  organizationId: "org-1",
  subject: { type: "security_event", id: "se-1" },
  severity: "high",
  title: "Security event (high): egress.blocked",
  link: "https://console.example/security/events/se-1",
  data: { severity: "high" },
};

describe("network safety (pure)", () => {
  it("classifies private, loopback, link-local, CGNAT and metadata addresses", () => {
    for (const ip of [
      "10.1.2.3",
      "127.0.0.1",
      "169.254.169.254",
      "172.16.0.1",
      "192.168.1.1",
      "100.64.0.1",
      "0.0.0.0",
      "::1",
      "fd00::1",
      "fe80::1",
      "::ffff:10.0.0.1",
      "224.0.0.1",
    ])
      expect({ ip, p: isPrivateAddress(ip) }).toEqual({ ip, p: true });
    for (const ip of ["8.8.8.8", "34.120.1.1", "2606:4700::1111"])
      expect({ ip, p: isPrivateAddress(ip) }).toEqual({ ip, p: false });
  });

  it("requires HTTPS and public addresses, and refuses credentials in the URL", async () => {
    const was = env().AEGIS_ALLOW_PRIVATE_DESTINATIONS;
    env().AEGIS_ALLOW_PRIVATE_DESTINATIONS = false;
    try {
      const resolveTo = (ips: string[]) => async () => ips;
      await expect(
        assertSafeDestinationUrl(
          "http://hooks.example.com/x",
          resolveTo(["8.8.8.8"]),
        ),
      ).rejects.toThrow(/HTTPS/);
      await expect(
        assertSafeDestinationUrl(
          "https://internal.example.com/x",
          resolveTo(["10.0.0.5"]),
        ),
      ).rejects.toThrow(/private/);
      await expect(
        assertSafeDestinationUrl(
          "https://meta.example.com/x",
          resolveTo(["8.8.8.8", "169.254.169.254"]),
        ),
      ).rejects.toThrow(/private/);
      await expect(
        assertSafeDestinationUrl("https://127.0.0.1/x"),
      ).rejects.toThrow(/private/);
      await expect(
        assertSafeDestinationUrl("https://localhost/x"),
      ).rejects.toThrow(/public internet/);
      await expect(
        assertSafeDestinationUrl(
          "https://user:pass@hooks.example.com/x",
          resolveTo(["8.8.8.8"]),
        ),
      ).rejects.toThrow(/credential/);
      await expect(
        assertSafeDestinationUrl(
          "https://hooks.example.com/x",
          resolveTo(["8.8.8.8"]),
        ),
      ).resolves.toBeInstanceOf(URL);
    } finally {
      env().AEGIS_ALLOW_PRIVATE_DESTINATIONS = was;
    }
  });
});

describe("request shapes per destination (contract)", () => {
  it("signs generic webhooks so receivers can verify them", () => {
    const now = new Date("2026-10-14T08:00:05Z");
    const r = buildRequest(
      {
        kind: "webhook",
        config: { url: "https://hooks.example.com/aegis" },
        name: "SOC",
      },
      "whsec_test",
      sample,
      "del-1",
      now,
    );
    expect(r.url).toBe("https://hooks.example.com/aegis");
    expect(r.headers["x-aegis-signature"]).toBe(
      signWebhook("whsec_test", r.headers["x-aegis-timestamp"]!, r.body),
    );
    expect(r.headers).toMatchObject({
      "x-aegis-event": "security_event.created",
      "x-aegis-delivery": "del-1",
    });
    expect(JSON.parse(r.body)).toMatchObject({
      id: "evt-1",
      type: "security_event.created",
    });
  });

  it("formats Slack, Teams, Splunk HEC, Datadog Logs and ServiceNow per their public APIs", () => {
    const slack = buildRequest(
      { kind: "slack", config: {}, name: "s" },
      "https://hooks.slack.com/services/T/B/X",
      sample,
      "d",
    );
    expect(slack.url).toBe("https://hooks.slack.com/services/T/B/X");
    expect(JSON.parse(slack.body)).toMatchObject({
      text: expect.stringContaining("egress.blocked"),
      blocks: expect.any(Array),
    });
    const teams = JSON.parse(
      buildRequest(
        { kind: "teams", config: {}, name: "t" },
        "https://example.webhook.office.com/x",
        sample,
        "d",
      ).body,
    );
    expect(teams.attachments[0]).toMatchObject({
      contentType: "application/vnd.microsoft.card.adaptive",
      content: { type: "AdaptiveCard" },
    });
    const splunk = buildRequest(
      {
        kind: "splunk_hec",
        config: { url: "https://splunk.example.com:8088/", index: "aegis" },
        name: "s",
      },
      "hec-token-123",
      sample,
      "d",
    );
    expect(splunk.url).toBe(
      "https://splunk.example.com:8088/services/collector/event",
    );
    expect(splunk.headers.authorization).toBe("Splunk hec-token-123");
    expect(JSON.parse(splunk.body)).toMatchObject({
      sourcetype: "aegis:event",
      index: "aegis",
      event: { id: "evt-1" },
    });
    const dd = buildRequest(
      { kind: "datadog_logs", config: { site: "datadoghq.eu" }, name: "d" },
      "dd-api-key-1234567",
      sample,
      "d",
    );
    expect(dd.url).toBe("https://http-intake.logs.datadoghq.eu/api/v2/logs");
    expect(dd.headers["dd-api-key"]).toBe("dd-api-key-1234567");
    expect(JSON.parse(dd.body)[0]).toMatchObject({
      ddsource: "aegis",
      service: "aegis",
      message: sample.title,
    });
    const sn = buildRequest(
      {
        kind: "servicenow",
        config: {
          instanceUrl: "https://acme.service-now.com",
          username: "aegis.integration",
        },
        name: "n",
      },
      "pw",
      sample,
      "d",
    );
    expect(sn.url).toBe("https://acme.service-now.com/api/now/table/incident");
    expect(sn.headers.authorization).toBe(
      `Basic ${Buffer.from("aegis.integration:pw").toString("base64")}`,
    );
    expect(JSON.parse(sn.body)).toMatchObject({
      correlation_id: "evt-1",
      correlation_display: "AEGIS",
      urgency: "1",
      impact: "1",
    });
  });
});

// A local HTTP server standing in for every destination, so the dispatcher is exercised over a real socket.
interface Received {
  path: string;
  headers: IncomingMessage["headers"];
  body: string;
}
let server: Server;
let base = "";
const received: Received[] = [];
let failPaths: Record<string, number> = {};
let t: TestTenant;
const run = <T>(fn: Parameters<typeof withTenant<T>>[1]) =>
  withTenant(t.orgId, fn);
const runner = <T>(fn: Parameters<typeof withTenant<T>>[1]) =>
  withTenant(t.orgId, fn);

beforeAll(async () => {
  env().AEGIS_ALLOW_PRIVATE_DESTINATIONS = true;
  server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      received.push({ path: req.url ?? "", headers: req.headers, body });
      const status =
        Object.entries(failPaths).find(([p]) =>
          (req.url ?? "").startsWith(p),
        )?.[1] ?? 200;
      res.writeHead(status, { "content-type": "application/json" });
      res.end(status === 200 ? '{"ok":true}' : '{"error":"nope"}');
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  t = await makeTestTenant("dest");
}, 60_000);

afterAll(async () => {
  env().AEGIS_ALLOW_PRIVATE_DESTINATIONS = false;
  await new Promise<void>((r) => server.close(() => r()));
  await t.cleanup();
  await disconnectAll();
});

describe("event destinations end to end", () => {
  const ids: Record<string, string> = {};

  it("only people with integrations:write add destinations, and secrets are never returned", async () => {
    const viewer = await addUserWithRole(t, "viewer", "v");
    await expect(
      run((db) =>
        createDestination(db, viewer.ctx, {
          kind: "slack",
          webhookUrl: `${base}/slack`,
          name: "x",
          categories: ["security"],
        }),
      ),
    ).rejects.toThrow(/integrations:write/);
    const agentCtx = makeContext(t.orgId, {
      type: "agent",
      id: "00000000-0000-7000-8000-000000000001",
      permissions: ["integrations:write"],
    });
    await expect(
      run((db) =>
        createDestination(db, agentCtx, {
          kind: "slack",
          webhookUrl: `${base}/slack`,
          name: "x",
          categories: ["security"],
        }),
      ),
    ).rejects.toThrow(/Only a person/);
    const wh = await run((db) =>
      createDestination(db, t.ownerCtx, {
        kind: "webhook",
        url: `${base}/webhook`,
        name: "SOC webhook",
        categories: ["security", "decisions"],
      }),
    );
    expect(wh.signingSecret).toMatch(/^whsec_/);
    ids.webhook = wh.destination.id;
    ids.slack = (
      await run((db) =>
        createDestination(db, t.ownerCtx, {
          kind: "slack",
          webhookUrl: `${base}/slack/T000/B000/secret-part`,
          name: "Slack #ai-governance",
          categories: ["security"],
          minSeverity: "high",
        }),
      )
    ).destination.id;
    ids.teams = (
      await run((db) =>
        createDestination(db, t.ownerCtx, {
          kind: "teams",
          webhookUrl: `${base}/teams`,
          name: "Teams",
          categories: ["security"],
        }),
      )
    ).destination.id;
    ids.splunk = (
      await run((db) =>
        createDestination(db, t.ownerCtx, {
          kind: "splunk_hec",
          url: `${base}/splunk`,
          token: "hec-token-abcdef",
          name: "Splunk",
          categories: ["security"],
        }),
      )
    ).destination.id;
    ids.datadog = (
      await run((db) =>
        createDestination(db, t.ownerCtx, {
          kind: "datadog_logs",
          site: "datadoghq.com",
          apiKey: "dd-api-key-0123456789",
          baseUrl: `${base}/datadog`,
          name: "Datadog",
          categories: ["security"],
        }),
      )
    ).destination.id;
    ids.servicenow = (
      await run((db) =>
        createDestination(db, t.ownerCtx, {
          kind: "servicenow",
          instanceUrl: `${base}/servicenow`,
          username: "aegis",
          password: "pw-1234",
          name: "ServiceNow",
          categories: ["security"],
        }),
      )
    ).destination.id;
    const list = await run((db) => listDestinations(db, t.ownerCtx));
    const text = JSON.stringify(list);
    for (const secret of [
      "secret-part",
      "hec-token-abcdef",
      "dd-api-key-0123456789",
      "pw-1234",
      wh.signingSecret!,
    ])
      expect(text).not.toContain(secret);
    expect(list.find((d) => d.id === ids.splunk)?.secretHint).toMatch(/cdef$/);
    const ledger = await run((db) =>
      db.evidenceEvent.findMany({
        where: { subjectType: "event_destination" },
      }),
    );
    expect(JSON.stringify(ledger.map((e) => e.payload))).not.toContain(
      "hec-token",
    );
  });

  it("delivers new matching events once to every destination, over HTTP, in each system's format", async () => {
    received.length = 0;
    await run((db) =>
      createSecurityEvent(db, t.ownerCtx, {
        type: "egress.blocked",
        severity: "high",
        title: "Egress blocked",
        escalate: false,
      }),
    );
    await run((db) =>
      createSecurityEvent(db, t.ownerCtx, {
        type: "policy.violation",
        severity: "medium",
        title: "Medium event",
        escalate: false,
      }),
    );
    // Lab traffic stays on the record but is never sent.
    await run((db) =>
      createSecurityEvent(db, t.ownerCtx, {
        type: "egress.blocked",
        severity: "critical",
        title: "[lab] egress blocked",
        escalate: false,
      }),
    );
    const out = await dispatchEvents(runner, t.orgId);
    expect(out.failed).toBe(0);
    const by = (p: string) => received.filter((r) => r.path.startsWith(p));
    // Slack has a high minimum: only the high event. The others get both non-lab events.
    expect(by("/slack")).toHaveLength(1);
    for (const p of [
      "/webhook",
      "/teams",
      "/splunk/services/collector/event",
      "/datadog/api/v2/logs",
      "/servicenow/api/now/table/incident",
    ])
      expect({ p, n: by(p).length }).toEqual({ p, n: 2 });
    const hook = by("/webhook")[0]!;
    expect(hook.headers["x-aegis-signature"]).toMatch(/^[0-9a-f]{64}$|^v1=/);
    expect(by("/splunk")[0]!.headers.authorization).toBe(
      "Splunk hec-token-abcdef",
    );
    expect(by("/datadog")[0]!.headers["dd-api-key"]).toBe(
      "dd-api-key-0123456789",
    );
    expect(JSON.stringify(received)).not.toContain("[lab]");
    // A second pass sends nothing new.
    received.length = 0;
    await dispatchEvents(runner, t.orgId);
    expect(received).toHaveLength(0);
  });

  it("retries server errors with backoff, fails client errors for good, and a person can retry a failed delivery", async () => {
    failPaths = { "/teams": 500, "/splunk": 403 };
    await run((db) =>
      createSecurityEvent(db, t.ownerCtx, {
        type: "egress.blocked",
        severity: "high",
        title: "Another",
        escalate: false,
      }),
    );
    await dispatchEvents(runner, t.orgId);
    const teams = await run((db) => getDestination(db, t.ownerCtx, ids.teams!));
    const pending = teams.deliveries.find((d) => d.status === "pending")!;
    expect(pending).toMatchObject({ attempts: 1, responseStatus: 500 });
    expect(pending.nextAttemptAt.getTime()).toBeGreaterThan(
      Date.now() + 30_000,
    );
    const splunk = await run((db) =>
      getDestination(db, t.ownerCtx, ids.splunk!),
    );
    const failed = splunk.deliveries.find((d) => d.status === "failed")!;
    expect(failed).toMatchObject({ responseStatus: 403 });
    failPaths = {};
    await run((db) => retryDelivery(db, t.ownerCtx, failed.id));
    await dispatchEvents(runner, t.orgId);
    const again = await run((db) =>
      db.eventDelivery.findUniqueOrThrow({ where: { id: failed.id } }),
    );
    expect(again.status).toBe("delivered");
  });

  it("a test event marks the destination verified; disabled destinations receive nothing", async () => {
    const r = await sendTestEvent(runner, t.ownerCtx, ids.webhook!);
    expect(r.ok).toBe(true);
    const d = await run((db) => getDestination(db, t.ownerCtx, ids.webhook!));
    expect(d.destination.verifiedAt).not.toBeNull();
    await run((db) =>
      updateDestination(db, t.ownerCtx, ids.slack!, { enabled: false }),
    );
    received.length = 0;
    await run((db) =>
      createSecurityEvent(db, t.ownerCtx, {
        type: "egress.blocked",
        severity: "critical",
        title: "While disabled",
        escalate: false,
      }),
    );
    await dispatchEvents(runner, t.orgId);
    expect(received.filter((x) => x.path.startsWith("/slack"))).toHaveLength(0);
    expect(received.filter((x) => x.path.startsWith("/webhook"))).toHaveLength(
      1,
    );
  });
});
