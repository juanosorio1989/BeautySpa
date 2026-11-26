import { createHmac, timingSafeEqual } from "node:crypto";

/** What a manage link proves: which appointment, at which `manage_version`, valid until `exp` (epoch seconds). */
export interface ManageClaims {
  appointmentId: string;
  manageVersion: number;
  exp: number;
}

function sign(secret: string, payloadPart: string): string {
  return createHmac("sha256", Buffer.from(secret, "base64")).update(payloadPart).digest("base64url");
}

/**
 * Stateless manage-link token: `base64url(JSON {a,v,e}) "." base64url(HMAC-SHA256(key, payloadPart))`,
 * key = the base64-decoded `MANAGE_LINK_SECRET`. The HMAC covers the encoded payload string as sent.
 */
export function signManageToken(secret: string, claims: ManageClaims): string {
  const payloadPart = Buffer.from(
    JSON.stringify({ a: claims.appointmentId, v: claims.manageVersion, e: claims.exp }),
  ).toString("base64url");
  return `${payloadPart}.${sign(secret, payloadPart)}`;
}

/**
 * Returns the claims, or `null` on a bad shape, a signature mismatch (constant-time, length checked first),
 * bad JSON, wrong claim types, or `nowMs >= exp * 1000`. Callers still check the appointment and its
 * `manage_version`; every failure must look the same to the client.
 */
export function verifyManageToken(secret: string, token: string, nowMs: number): ManageClaims | null {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [payloadPart, sigPart] = parts as [string, string];
  if (payloadPart === "" || sigPart === "") return null;

  // Comparing the canonical encodings also rejects non-canonical base64url spellings of the same bytes.
  const expected = Buffer.from(sign(secret, payloadPart));
  const given = Buffer.from(sigPart);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;

  let payload: unknown;
  try {
    payload = JSON.parse(Buffer.from(payloadPart, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (typeof payload !== "object" || payload === null) return null;
  const { a, v, e } = payload as Record<string, unknown>;
  if (typeof a !== "string" || a === "") return null;
  if (typeof v !== "number" || !Number.isSafeInteger(v)) return null;
  if (typeof e !== "number" || !Number.isSafeInteger(e)) return null;
  if (nowMs >= e * 1000) return null;
  return { appointmentId: a, manageVersion: v, exp: e };
}

/** The customer-facing manage page URL. */
export function manageUrl(webOrigin: string, locale: string, token: string): string {
  return `${webOrigin}/${locale}/manage/${token}`;
}
