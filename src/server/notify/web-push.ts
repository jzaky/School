// Web push sender (RFC 8030) with VAPID authentication (RFC 8292) and aes128gcm payload encryption
// (RFC 8188 and RFC 8291), on Node's built-in crypto. No third-party library is needed.
import crypto from "node:crypto";

export type PushTarget = { endpoint: string; p256dh: string; auth: string };
export type VapidKeys = { publicKey: string; privateKey: string; subject: string };

export const b64url = (buf: Buffer | Uint8Array) => Buffer.from(buf).toString("base64url");
export const fromB64url = (s: string) => Buffer.from(s.replace(/=+$/, ""), "base64url");

/** A fresh VAPID key pair (base64url: 65-byte uncompressed public point, 32-byte private scalar). */
export function generateVapidKeys() {
  const ecdh = crypto.createECDH("prime256v1");
  ecdh.generateKeys();
  return { publicKey: b64url(ecdh.getPublicKey()), privateKey: b64url(ecdh.getPrivateKey()) };
}

function privateKeyObject(publicKey: string, privateKey: string) {
  const pub = fromB64url(publicKey);
  if (pub.length !== 65 || pub[0] !== 4) throw new Error("vapid_public_key_invalid");
  return crypto.createPrivateKey({
    key: { kty: "EC", crv: "P-256", d: b64url(fromB64url(privateKey)), x: b64url(pub.subarray(1, 33)), y: b64url(pub.subarray(33, 65)) },
    format: "jwk",
  });
}

/** The Authorization header value for one push service origin. */
export function vapidAuthorization(endpoint: string, keys: VapidKeys, now = new Date()) {
  const aud = new URL(endpoint).origin;
  const header = b64url(Buffer.from(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = b64url(Buffer.from(JSON.stringify({ aud, exp: Math.floor(now.getTime() / 1000) + 12 * 3600, sub: keys.subject })));
  const unsigned = `${header}.${claims}`;
  const sig = crypto.sign("sha256", Buffer.from(unsigned), { key: privateKeyObject(keys.publicKey, keys.privateKey), dsaEncoding: "ieee-p1363" });
  return `vapid t=${unsigned}.${b64url(sig)}, k=${keys.publicKey}`;
}

const hmac = (key: Buffer, data: Buffer) => crypto.createHmac("sha256", key).update(data).digest();

/**
 * Encrypt a payload for one subscription (aes128gcm, a single record).
 * `salt` and `serverKeys` are parameters only so tests can be deterministic.
 */
export function encryptPayload(target: PushTarget, payload: Buffer, opts: { salt?: Buffer; serverKeys?: crypto.ECDH } = {}) {
  const uaPublic = fromB64url(target.p256dh);
  const authSecret = fromB64url(target.auth);
  const server = opts.serverKeys ?? crypto.createECDH("prime256v1");
  if (!opts.serverKeys) server.generateKeys();
  const asPublic = server.getPublicKey();
  const ecdhSecret = server.computeSecret(uaPublic);
  const salt = opts.salt ?? crypto.randomBytes(16);

  const prkKey = hmac(authSecret, ecdhSecret);
  const keyInfo = Buffer.concat([Buffer.from("WebPush: info\0"), uaPublic, asPublic]);
  const ikm = hmac(prkKey, Buffer.concat([keyInfo, Buffer.from([1])]));
  const prk = hmac(salt, ikm);
  const cek = hmac(prk, Buffer.from("Content-Encoding: aes128gcm\0\x01")).subarray(0, 16);
  const nonce = hmac(prk, Buffer.from("Content-Encoding: nonce\0\x01")).subarray(0, 12);

  const cipher = crypto.createCipheriv("aes-128-gcm", cek, nonce);
  // 0x02 marks the last (and only) record.
  const body = Buffer.concat([cipher.update(Buffer.concat([payload, Buffer.from([2])])), cipher.final(), cipher.getAuthTag()]);
  const rs = Buffer.alloc(4);
  rs.writeUInt32BE(4096);
  return Buffer.concat([salt, rs, Buffer.from([asPublic.length]), asPublic, body]);
}

/** What the service worker receives. Kept small: push services cap payloads at about 4 KB. */
export type PushPayload = { title: string; body?: string | null; url: string; tag?: string; lang: "en" | "ar"; dir: "ltr" | "rtl" };

export type PushRequest = { url: string; init: { method: "POST"; headers: Record<string, string>; body: Buffer } };

export function buildPushRequest(target: PushTarget, payload: PushPayload, keys: VapidKeys, opts: { urgent?: boolean; ttl?: number; now?: Date } = {}): PushRequest {
  const body = encryptPayload(target, Buffer.from(JSON.stringify(payload)));
  return {
    url: target.endpoint,
    init: {
      method: "POST",
      headers: {
        Authorization: vapidAuthorization(target.endpoint, keys, opts.now),
        "Content-Encoding": "aes128gcm",
        "Content-Type": "application/octet-stream",
        TTL: String(opts.ttl ?? 86400),
        Urgency: opts.urgent ? "high" : "normal",
      },
      body,
    },
  };
}

export type PushOutcome = { endpoint: string; ok: boolean; gone: boolean; status: number };

/** Send to every device of one member. Expired subscriptions (404, 410) are reported as gone. */
export async function sendPush(targets: PushTarget[], payload: PushPayload, keys: VapidKeys, opts: { urgent?: boolean; fetchImpl?: typeof fetch } = {}): Promise<PushOutcome[]> {
  const f = opts.fetchImpl ?? fetch;
  const out: PushOutcome[] = [];
  for (const t of targets) {
    const req = buildPushRequest(t, payload, keys, opts);
    try {
      const res = await f(req.url, { ...req.init, body: new Uint8Array(req.init.body) });
      out.push({ endpoint: t.endpoint, ok: res.ok, gone: res.status === 404 || res.status === 410, status: res.status });
    } catch {
      out.push({ endpoint: t.endpoint, ok: false, gone: false, status: 0 });
    }
  }
  return out;
}
