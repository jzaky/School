// Push, WhatsApp, fees and career report logic that runs without a database.
import crypto from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { deviceText, isSensitiveForDevice, normalizePhone, pushConfig, whatsappConfig, maskPhone } from "@/server/notify/channels";
import { buildPushRequest, encryptPayload, fromB64url, generateVapidKeys, sendPush, vapidAuthorization, b64url } from "@/server/notify/web-push";
import { buildWhatsAppPayload, sendWhatsApp } from "@/server/notify/whatsapp";
import { validPushSubscription } from "@/server/notify/devices";
import { parseFeeSettings } from "@/server/fees/settings";
import { careerReportAudience, nextStepsFor } from "@/server/career/report";

// A browser-side subscription: the user agent's key pair and auth secret.
function fakeBrowser() {
  const ua = crypto.createECDH("prime256v1");
  ua.generateKeys();
  const auth = crypto.randomBytes(16);
  return { ua, auth, target: { endpoint: "https://push.example.net/send/abc123", p256dh: b64url(ua.getPublicKey()), auth: b64url(auth) } };
}

/** RFC 8291 decryption as a browser does it, to prove the payload round-trips. */
function decrypt(body: Buffer, ua: crypto.ECDH, authSecret: Buffer) {
  const salt = body.subarray(0, 16);
  const idlen = body[20];
  const asPublic = body.subarray(21, 21 + idlen);
  const ciphertext = body.subarray(21 + idlen);
  const hmac = (k: Buffer, d: Buffer) => crypto.createHmac("sha256", k).update(d).digest();
  const ecdhSecret = ua.computeSecret(asPublic);
  const prkKey = hmac(authSecret, ecdhSecret);
  const ikm = hmac(prkKey, Buffer.concat([Buffer.from("WebPush: info\0"), ua.getPublicKey(), asPublic, Buffer.from([1])]));
  const prk = hmac(salt, ikm);
  const cek = hmac(prk, Buffer.from("Content-Encoding: aes128gcm\0\x01")).subarray(0, 16);
  const nonce = hmac(prk, Buffer.from("Content-Encoding: nonce\0\x01")).subarray(0, 12);
  const d = crypto.createDecipheriv("aes-128-gcm", cek, nonce);
  d.setAuthTag(ciphertext.subarray(ciphertext.length - 16));
  const plain = Buffer.concat([d.update(ciphertext.subarray(0, ciphertext.length - 16)), d.final()]);
  expect(plain[plain.length - 1]).toBe(2);
  return plain.subarray(0, plain.length - 1).toString("utf8");
}

describe("sensitive content on devices", () => {
  const base = { subject: "Concern logged for Adam Nasser", body: "Details of the wellbeing concern", locale: "en" as const, school: "Horizon International School" };

  it("replaces wellbeing, safeguarding, medical and confidential content with a generic line", () => {
    for (const sensitivity of ["WELLBEING", "SAFEGUARDING", "MEDICAL", "CONFIDENTIAL"] as const) {
      const out = deviceText({ ...base, kind: "request_completed", sensitivity });
      expect(out.generic).toBe(true);
      expect(out.title).not.toContain("Adam");
      expect(out.body ?? "").not.toContain("wellbeing");
      expect(out.title).toContain("Horizon International School");
    }
  });

  it("treats case and safeguarding kinds as sensitive even without a sensitivity", () => {
    for (const kind of ["parent_update", "case_assigned", "safeguarding_immediate", "break_glass", "wellbeing_referral"]) {
      expect(isSensitiveForDevice(kind, null)).toBe(true);
      expect(deviceText({ ...base, kind }).generic).toBe(true);
    }
  });

  it("keeps standard updates and clips long text", () => {
    const out = deviceText({ ...base, kind: "request_completed", sensitivity: "STANDARD", subject: "Your request is complete", body: "x".repeat(400) });
    expect(out.generic).toBe(false);
    expect(out.title).toBe("Your request is complete");
    expect(out.body!.length).toBeLessThanOrEqual(180);
  });

  it("writes the generic line in Arabic", () => {
    const out = deviceText({ ...base, kind: "parent_update", locale: "ar", school: "مدرسة هورايزن" });
    expect(out.title).toContain("مدرسة هورايزن");
  });
});

describe("channel configuration", () => {
  it("hides push without a full VAPID configuration", () => {
    expect(pushConfig({})).toBeNull();
    expect(pushConfig({ WEB_PUSH_PUBLIC_KEY: "a", WEB_PUSH_PRIVATE_KEY: "b" })).toBeNull();
    expect(pushConfig({ WEB_PUSH_PUBLIC_KEY: "a", WEB_PUSH_PRIVATE_KEY: "b", WEB_PUSH_SUBJECT: "nobody" })).toBeNull();
    expect(pushConfig({ WEB_PUSH_PUBLIC_KEY: "a", WEB_PUSH_PRIVATE_KEY: "b", WEB_PUSH_SUBJECT: "mailto:it@school.example" })).not.toBeNull();
  });

  it("offers WhatsApp only when a provider is chosen and Meta is fully configured", () => {
    expect(whatsappConfig({})).toBeNull();
    expect(whatsappConfig({ WHATSAPP_PROVIDER: "console" })).toEqual({ provider: "console" });
    expect(whatsappConfig({ WHATSAPP_PROVIDER: "meta", WHATSAPP_TOKEN: "t" })).toBeNull();
    const cfg = whatsappConfig({ WHATSAPP_PROVIDER: "meta", WHATSAPP_TOKEN: "t", WHATSAPP_PHONE_NUMBER_ID: "123", WHATSAPP_TEMPLATE_GENERIC: "school_update", WHATSAPP_TEMPLATE_REQUEST_COMPLETED: "request_done" });
    expect(cfg).toMatchObject({ provider: "meta", genericTemplate: "school_update", templates: { request_completed: "request_done" }, apiVersion: "v21.0" });
  });

  it("normalizes phone numbers to E.164", () => {
    expect(normalizePhone("050 123 4567")).toBe("+971501234567");
    expect(normalizePhone("00971-50-123-4567")).toBe("+971501234567");
    expect(normalizePhone("+44 20 7946 0000")).toBe("+442079460000");
    expect(normalizePhone("12345")).toBeNull();
    expect(normalizePhone("not a number")).toBeNull();
    expect(maskPhone("+971501234567")).toBe("•••• 4567");
  });
});

describe("WhatsApp Cloud API payload", () => {
  const cfg = { provider: "meta" as const, token: "secret-token", phoneNumberId: "1098765", apiVersion: "v21.0", templates: { request_completed: "request_done" }, genericTemplate: "school_update" };

  it("uses the per-kind template with the title and a portal link button", () => {
    const p = buildWhatsAppPayload(cfg, { to: "+971501234567", kind: "request_completed", locale: "ar", school: "مدرسة هورايزن", title: "اكتمل طلبك", href: "/requests/abc" });
    expect(p).toMatchObject({ messaging_product: "whatsapp", to: "971501234567", type: "template" });
    expect(p.template.name).toBe("request_done");
    expect(p.template.language.code).toBe("ar");
    expect(p.template.components[0]).toEqual({ type: "body", parameters: [{ type: "text", text: "مدرسة هورايزن" }, { type: "text", text: "اكتمل طلبك" }] });
    expect(p.template.components[1]).toEqual({ type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: "ar/requests/abc" }] });
  });

  it("falls back to the generic template and sends no title for sensitive content", () => {
    const p = buildWhatsAppPayload(cfg, { to: "+971501234567", kind: "request_completed", locale: "en", school: "Horizon", title: null, href: "/cases/x" });
    expect(p.template.name).toBe("school_update");
    expect(p.template.components[0]).toEqual({ type: "body", parameters: [{ type: "text", text: "Horizon" }] });
    expect(JSON.stringify(p)).not.toContain("Adam");
  });

  it("uses the generic template for a kind without its own template", () => {
    const p = buildWhatsAppPayload(cfg, { to: "+971501234567", kind: "meeting_booked", locale: "en", school: "Horizon", title: "Meeting booked", href: null });
    expect(p.template.name).toBe("school_update");
    expect(p.template.components).toHaveLength(1);
  });

  it("posts to the Graph API with the bearer token (mocked fetch)", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ messages: [{ id: "wamid.ABC" }] }), { status: 200 }));
    const res = await sendWhatsApp(cfg, { to: "+971501234567", kind: "request_completed", locale: "en", school: "Horizon", title: "Done", href: "/requests/1" }, fetchMock as unknown as typeof fetch);
    expect(res.providerId).toBe("wamid.ABC");
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://graph.facebook.com/v21.0/1098765/messages");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer secret-token");
    expect(JSON.parse(init.body as string).template.name).toBe("request_done");
  });

  it("surfaces only the status when Meta rejects a message", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ error: { message: "bad number +971501234567" } }), { status: 400 }));
    await expect(sendWhatsApp(cfg, { to: "+971501234567", kind: "x", locale: "en", school: "H", title: "T", href: null }, fetchMock as unknown as typeof fetch)).rejects.toThrow(/^whatsapp_http_400$/);
  });
});

describe("web push", () => {
  const keys = { ...generateVapidKeys(), subject: "mailto:it@school.example" };

  it("encrypts a payload the browser can decrypt (aes128gcm)", () => {
    const { ua, auth, target } = fakeBrowser();
    const body = encryptPayload(target, Buffer.from(JSON.stringify({ title: "مرحبا", url: "/ar/home" })));
    expect(body.readUInt32BE(16)).toBe(4096);
    expect(JSON.parse(decrypt(body, ua, auth))).toEqual({ title: "مرحبا", url: "/ar/home" });
  });

  it("signs a VAPID token for the push service origin", () => {
    const header = vapidAuthorization("https://fcm.googleapis.com/fcm/send/xyz", keys, new Date("2026-10-01T00:00:00Z"));
    const m = /^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/.exec(header)!;
    expect(m).not.toBeNull();
    expect(m[4]).toBe(keys.publicKey);
    const claims = JSON.parse(Buffer.from(m[2], "base64url").toString());
    expect(claims).toMatchObject({ aud: "https://fcm.googleapis.com", sub: "mailto:it@school.example" });
    const pub = fromB64url(keys.publicKey);
    const key = crypto.createPublicKey({ key: { kty: "EC", crv: "P-256", x: b64url(pub.subarray(1, 33)), y: b64url(pub.subarray(33)) }, format: "jwk" });
    const ok = crypto.verify("sha256", Buffer.from(`${m[1]}.${m[2]}`), { key, dsaEncoding: "ieee-p1363" }, Buffer.from(m[3], "base64url"));
    expect(ok).toBe(true);
  });

  it("builds the request headers", () => {
    const { target } = fakeBrowser();
    const req = buildPushRequest(target, { title: "T", url: "/en/home", lang: "en", dir: "ltr" }, keys, { urgent: true });
    expect(req.url).toBe(target.endpoint);
    expect(req.init.headers).toMatchObject({ "Content-Encoding": "aes128gcm", TTL: "86400", Urgency: "high" });
  });

  it("reports expired subscriptions as gone (mocked fetch)", async () => {
    const a = fakeBrowser().target;
    const b = { ...fakeBrowser().target, endpoint: "https://push.example.net/send/expired" };
    const fetchMock = vi.fn(async (url: string) => new Response(null, { status: url.endsWith("expired") ? 410 : 201 }));
    const out = await sendPush([a, b], { title: "T", url: "/en/home", lang: "en", dir: "ltr" }, keys, { fetchImpl: fetchMock as unknown as typeof fetch });
    expect(out.map((o) => [o.ok, o.gone])).toEqual([
      [true, false],
      [false, true],
    ]);
  });

  it("accepts only well-formed browser subscriptions", () => {
    const { target } = fakeBrowser();
    expect(validPushSubscription(target)).toBe(true);
    expect(validPushSubscription({ ...target, endpoint: "http://push.example.net/x" })).toBe(false);
    expect(validPushSubscription({ ...target, p256dh: "short" })).toBe(false);
    expect(validPushSubscription({ ...target, auth: b64url(crypto.randomBytes(8)) })).toBe(false);
  });
});

describe("fee settings", () => {
  it("accepts an https link and an optional contact", () => {
    expect(parseFeeSettings({ url: " https://pay.school.example/fees ", contact: "  accounts@school.example  " })).toEqual({ ok: true, url: "https://pay.school.example/fees", contact: "accounts@school.example" });
    expect(parseFeeSettings({ url: "", contact: "" })).toEqual({ ok: true, url: null, contact: null });
  });

  it("rejects links that are not https or carry credentials", () => {
    expect(parseFeeSettings({ url: "http://pay.school.example", contact: "" })).toMatchObject({ ok: false, error: "URL_INVALID" });
    expect(parseFeeSettings({ url: "javascript:alert(1)", contact: "" })).toMatchObject({ ok: false, error: "URL_INVALID" });
    expect(parseFeeSettings({ url: "https://user:pw@pay.school.example", contact: "" })).toMatchObject({ ok: false, error: "URL_INVALID" });
    expect(parseFeeSettings({ url: "pay.school.example", contact: "" })).toMatchObject({ ok: false, error: "URL_INVALID" });
  });
});

describe("career report access and next steps", () => {
  const can = (perms: string[]) => (p: string) => perms.includes(p);
  it("lets students and parents download only their own", () => {
    expect(careerReportAudience({ isStudent: true, isParent: false, isStaff: false, can: can([]), visibleStudentIds: ["s1"] }, "s1")).toBe("student");
    expect(careerReportAudience({ isStudent: true, isParent: false, isStaff: false, can: can([]), visibleStudentIds: ["s1"] }, "s2")).toBeNull();
    expect(careerReportAudience({ isStudent: false, isParent: true, isStaff: false, can: can([]), visibleStudentIds: ["s1", "s3"] }, "s3")).toBe("family");
    expect(careerReportAudience({ isStudent: false, isParent: true, isStaff: false, can: can([]), visibleStudentIds: ["s1"] }, "s2")).toBeNull();
  });

  it("lets staff download only with a career or pathways permission", () => {
    expect(careerReportAudience({ isStudent: false, isParent: false, isStaff: true, can: can(["career.advise"]), visibleStudentIds: null }, "s9")).toBe("staff");
    expect(careerReportAudience({ isStudent: false, isParent: false, isStaff: true, can: can(["people.view"]), visibleStudentIds: null }, "s9")).toBeNull();
    expect(careerReportAudience({ isStudent: false, isParent: false, isStaff: true, can: can(["career.advise"]), visibleStudentIds: [] }, "s9")).toBeNull();
  });

  it("suggests next steps from the plan status", () => {
    const base = { hasAssessment: true, reviewedCount: 3, pendingCount: 0, chosen: false, shortlist: 0, grade: 9 };
    expect(nextStepsFor({ ...base, plan: null }).map((s) => s.en).join(" ")).toContain("Build a course plan");
    expect(nextStepsFor({ ...base, plan: "PROPOSED" }).map((s) => s.en).join(" ")).toContain("Wait for the counselor");
    expect(nextStepsFor({ ...base, plan: "APPROVED", grade: 11 }).map((s) => s.en).join(" ")).toContain("university shortlist");
    expect(nextStepsFor({ ...base, reviewedCount: 0, pendingCount: 4, plan: null }).map((s) => s.en).join(" ")).toContain("career advisor will review");
    for (const s of nextStepsFor({ ...base, plan: "DRAFT", chosen: true, grade: 12, shortlist: 2 })) expect(s.ar.length).toBeGreaterThan(5);
  });
});
