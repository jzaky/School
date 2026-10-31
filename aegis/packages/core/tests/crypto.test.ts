import { describe, expect, it } from "vitest";
import { canonicalJson, decryptSecret, encryptSecret, hashObject, maskSecret, trimTrailing } from "../src/lib/crypto.js";
import { base32Decode, base32Encode, generateTotpSecret, totpCode, verifyTotp } from "../src/identity/totp.js";
import { generateApiKey } from "../src/identity/api-keys.js";

describe("canonical JSON", () => {
  it("orders keys and drops undefined", () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: [3, { z: 1, y: 2 }] }, u: undefined })).toBe('{"a":{"c":[3,{"y":2,"z":1}],"d":2},"b":1}');
  });
  it("hashes identical logical content identically", () => {
    expect(hashObject({ amount: 500, currency: "AED" })).toBe(hashObject({ currency: "AED", amount: 500 }));
    expect(hashObject({ amount: 500 })).not.toBe(hashObject({ amount: 501 }));
  });
  it("normalises floats so values survive a database round trip", () => {
    expect(canonicalJson({ x: 1 / 24 })).toBe(canonicalJson({ x: 0.04166666666666666 }));
    expect(canonicalJson({ x: 0.1 + 0.2 })).toBe(canonicalJson({ x: 0.3 }));
    expect(canonicalJson({ n: 250000, m: 2500.5, big: 1e21 })).toBe('{"big":1e+21,"m":2500.5,"n":250000}');
  });
  it("serialises dates and bigints deterministically", () => {
    expect(canonicalJson({ d: new Date("2026-01-01T00:00:00.000Z"), n: 10n })).toBe('{"d":"2026-01-01T00:00:00.000Z","n":"10"}');
  });
});

describe("trimTrailing", () => {
  it("removes every trailing character in linear time (replaces /x+$/ regexes, SAST ReDoS fix)", () => {
    expect(trimTrailing("https://a.example///", "/")).toBe("https://a.example");
    expect(trimTrailing("JBSWY3DP====", "=")).toBe("JBSWY3DP");
    expect(trimTrailing("////", "/")).toBe("");
    const t0 = Date.now();
    expect(trimTrailing("/".repeat(200_000) + "x", "/")).toHaveLength(200_001);
    expect(Date.now() - t0).toBeLessThan(500);
  });
});

describe("secret envelope", () => {
  it("round-trips and binds to its context", () => {
    const enc = encryptSecret("super-secret", "row:1");
    expect(enc.startsWith("v2.")).toBe(true);
    expect(decryptSecret(enc, "row:1")).toBe("super-secret");
    expect(() => decryptSecret(enc, "row:2")).toThrow();
    expect(() => decryptSecret(enc.slice(0, -2) + "zz", "row:1")).toThrow();
  });
  it("refuses a truncated authentication tag (GCM tag length is fixed at 16 bytes)", () => {
    const enc = encryptSecret("super-secret", "row:1");
    const parts = enc.split(".");
    const tag = Buffer.from(parts[4]!, "base64url");
    // A 4-byte tag would be accepted by a decipher without a fixed tag length, cutting forgery cost to 2^32.
    const short = [...parts.slice(0, 4), tag.subarray(0, 4).toString("base64url")].join(".");
    expect(() => decryptSecret(short, "row:1")).toThrow();
  });
  it("never produces the same ciphertext twice", () => {
    expect(encryptSecret("x")).not.toBe(encryptSecret("x"));
  });
  it("masks for display", () => {
    expect(maskSecret("aegis_ak_abcdef_secret", 9)).toBe("aegis_ak_************");
  });
});

describe("TOTP (RFC 6238)", () => {
  it("matches the RFC 6238 SHA-1 test vector for T=59", () => {
    // Secret "12345678901234567890", 8 digits -> 94287082; 6 digits -> 287082
    const secret = base32Encode(Buffer.from("12345678901234567890"));
    expect(totpCode(secret, 59_000, 30, 8)).toBe("94287082");
    expect(totpCode(secret, 1_111_111_109_000, 30, 8)).toBe("07081804");
  });
  it("round-trips base32", () => {
    const s = generateTotpSecret();
    expect(base32Encode(base32Decode(s))).toBe(s);
  });
  it("accepts codes within the window and rejects others", () => {
    const s = generateTotpSecret();
    const now = Date.now();
    expect(verifyTotp(s, totpCode(s, now), 1, now)).toBe(true);
    expect(verifyTotp(s, totpCode(s, now - 30_000), 1, now)).toBe(true);
    expect(verifyTotp(s, totpCode(s, now - 90_000), 1, now)).toBe(false);
    expect(verifyTotp(s, "abcdef", 1, now)).toBe(false);
  });
});

describe("API keys", () => {
  it("have a recognisable prefix and a hash that does not reveal the key", () => {
    const k = generateApiKey();
    expect(k.key.startsWith(`aegis_ak_${k.prefix}_`)).toBe(true);
    expect(k.keyHash).toHaveLength(64);
    expect(k.key).not.toContain(k.keyHash);
  });
});
