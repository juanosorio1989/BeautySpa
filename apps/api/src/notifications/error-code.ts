import { PushError } from "./providers/channel-provider.js";

const RESEND = /^Resend send failed: (\d{3}|timeout)$/;
const MAX = 200;

/**
 * The short code stored in `notification_log.error`: `resend_<status>`, `resend_timeout`, `push_<status>`,
 * `push_none`, else `unknown`. Built only from recognized shapes, never from free error text, so no
 * email, phone or provider body can leak. At most 200 chars.
 */
export function errorCode(err: unknown): string {
  let code = "unknown";
  if (err instanceof PushError) {
    code = typeof err.status === "number" && Number.isInteger(err.status) ? `push_${err.status}` : "push_none";
  } else if (err instanceof Error) {
    const m = RESEND.exec(err.message);
    if (m) code = `resend_${m[1]}`;
  }
  return code.slice(0, MAX);
}
