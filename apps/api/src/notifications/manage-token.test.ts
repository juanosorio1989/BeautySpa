import { createHmac, randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { manageUrl, signManageToken, verifyManageToken, type ManageClaims } from "./manage-token.js";

const secret = randomBytes(32).toString("base64");
const claims: ManageClaims = {
  appointmentId: "8f0c1b2a-3d4e-4f50-9a6b-7c8d9e0f1a2b",
  manageVersion: 3,
  exp: 1_800_000_000,
};
const before = claims.exp * 1000 - 1;

/** Replaces the character at `i` with a different base64url character. */
function flipAt(s: string, i: number): string {
  const c = s[i] === "A" ? "B" : "A";
  return s.slice(0, i) + c + s.slice(i + 1);
}

/** A correctly signed token around an arbitrary payload string. */
function signRaw(payloadJson: string): string {
  const payload = Buffer.from(payloadJson).toString("base64url");
  const sig = createHmac("sha256", Buffer.from(secret, "base64")).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

describe("manage token", () => {
  it("round trips claims", () => {
    const token = signManageToken(secret, claims);
    expect(token).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(verifyManageToken(secret, token, before)).toEqual(claims);
  });

  it("rejects a flipped payload byte", () => {
    const token = signManageToken(secret, claims);
    expect(verifyManageToken(secret, flipAt(token, 2), before)).toBeNull();
  });

  it("rejects a flipped signature byte", () => {
    const token = signManageToken(secret, claims);
    expect(verifyManageToken(secret, flipAt(token, token.length - 3), before)).toBeNull();
  });

  it("rejects another secret", () => {
    const token = signManageToken(secret, claims);
    expect(verifyManageToken(randomBytes(32).toString("base64"), token, before)).toBeNull();
  });

  it("rejects at exp exactly", () => {
    const token = signManageToken(secret, claims);
    expect(verifyManageToken(secret, token, claims.exp * 1000)).toBeNull();
    expect(verifyManageToken(secret, token, claims.exp * 1000 - 1)).toEqual(claims);
  });

  it("rejects garbage", () => {
    for (const t of ["", "a", "a.b.c", ".", "a.", ".b"]) {
      expect(verifyManageToken(secret, t, before)).toBeNull();
    }
    expect(verifyManageToken(secret, signRaw("not json"), before)).toBeNull();
    expect(verifyManageToken(secret, signRaw(JSON.stringify({ a: "x", v: "3", e: claims.exp })), before)).toBeNull();
    expect(verifyManageToken(secret, signRaw(JSON.stringify({ a: 1, v: 3, e: claims.exp })), before)).toBeNull();
    expect(verifyManageToken(secret, signRaw(JSON.stringify({ a: "x", v: 3, e: "1" })), before)).toBeNull();
    expect(verifyManageToken(secret, signRaw(JSON.stringify(null)), before)).toBeNull();
    // A truncated signature (length mismatch) never reaches timingSafeEqual.
    const token = signManageToken(secret, claims);
    expect(verifyManageToken(secret, token.slice(0, -1), before)).toBeNull();
  });

  it("builds the manage URL", () => {
    expect(manageUrl("http://localhost:3000", "es", "abc.def")).toBe("http://localhost:3000/es/manage/abc.def");
  });
});
