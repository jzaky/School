import { describe, expect, it } from "vitest";
import { decryptField, encryptField, mask } from "@/lib/crypto";

describe("field encryption", () => {
  it("round-trips and never stores plaintext", () => {
    const enc = encryptField("784-2011-1234567-1");
    expect(enc).not.toContain("1234567");
    expect(decryptField(enc)).toBe("784-2011-1234567-1");
  });
  it("uses a fresh IV every time", () => {
    expect(encryptField("x")).not.toBe(encryptField("x"));
  });
  it("detects tampering", () => {
    const enc = encryptField("secret");
    const parts = enc.split(":");
    parts[3] = Buffer.from("tampered").toString("base64");
    expect(() => decryptField(parts.join(":"))).toThrow();
  });
  it("masks identifiers", () => {
    expect(mask("4567", "passport")).toBe("•••••4567");
    expect(mask(null, "eid")).toBe("");
  });
});
