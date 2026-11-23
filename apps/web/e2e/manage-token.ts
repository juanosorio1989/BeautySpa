import { createHmac } from "node:crypto";

/**
 * Mints a manage-link token the API accepts: `base64url(JSON {a,v,e}) "." base64url(HMAC-SHA256(key, payloadPart))`,
 * key = base64-decoded `MANAGE_LINK_SECRET` (loaded from the root `.env` by `test:e2e`). Mirrors
 * `apps/api/src/notifications/manage-token.ts` without importing it. `e` is epoch seconds; the API checks only `e > now`.
 */
export function mintManageToken(appointmentId: string, manageVersion = 0): string {
  const secret = process.env.MANAGE_LINK_SECRET;
  if (!secret) throw new Error("MANAGE_LINK_SECRET is not set (run secrets:gen; test:e2e loads the root .env)");
  const exp = Math.floor(Date.now() / 1000) + 24 * 60 * 60;
  const payloadPart = Buffer.from(JSON.stringify({ a: appointmentId, v: manageVersion, e: exp })).toString("base64url");
  const sig = createHmac("sha256", Buffer.from(secret, "base64")).update(payloadPart).digest("base64url");
  return `${payloadPart}.${sig}`;
}
