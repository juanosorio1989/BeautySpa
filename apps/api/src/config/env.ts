import { createPrivateKey } from "node:crypto";
import { isIP } from "node:net";
import { z } from "zod";

/** Nest injection token for the validated `Env` (provided by the global `ConfigModule`). */
export const ENV = Symbol("ENV");

const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

const bool = z.enum(["true", "false"]).transform((v) => v === "true");

/** Base64 of a PKCS#8 DER Ed25519 private key. */
const ed25519KeyB64 = z.string().refine((v) => {
  if (!BASE64.test(v)) return false;
  try {
    const key = createPrivateKey({ key: Buffer.from(v, "base64"), format: "der", type: "pkcs8" });
    return key.asymmetricKeyType === "ed25519";
  } catch {
    return false;
  }
}, "must be a base64 PKCS#8 DER Ed25519 private key");

/** One IPv4/IPv6 address, optionally with a CIDR prefix length. */
function isIpOrCidr(v: string): boolean {
  const [addr, prefix, ...rest] = v.split("/");
  if (rest.length > 0 || !addr) return false;
  const family = isIP(addr);
  if (family === 0) return false;
  if (prefix === undefined) return true;
  if (!/^\d{1,3}$/.test(prefix)) return false;
  // A /0 prefix matches every address: same as trusting everything.
  const bits = Number(prefix);
  return bits >= 1 && bits <= (family === 4 ? 32 : 128);
}

/**
 * Express `trust proxy`: `"false"` (or blank) → false, a positive integer → hop count,
 * else a comma-separated list of IPs/CIDRs. `"true"` is rejected: it trusts the
 * client-controlled left-most `X-Forwarded-For` entry and defeats per-IP limits.
 */
const trustProxy = z.string().transform((v, ctx): false | number | string[] => {
  const s = v.trim();
  if (s === "false" || s === "") return false;
  if (/^\d+$/.test(s)) {
    const n = Number(s);
    if (n >= 1 && Number.isSafeInteger(n)) return n;
  } else {
    const list = s.split(",").map((p) => p.trim());
    if (list.every(isIpOrCidr)) return list;
  }
  ctx.addIssue({
    code: z.ZodIssueCode.custom,
    message: 'must be "false", a positive hop count (1 on Railway/Fly), or a comma-separated list of IPs/CIDRs',
  });
  return z.NEVER;
});

const OTP_CHANNEL = z.enum(["whatsapp", "sms"]);

/**
 * Ordered, comma-separated OTP delivery channels (`whatsapp` | `sms`), tried in order by `OtpService.start`.
 * Items are trimmed; an empty list, unknown values and duplicates are rejected.
 */
const otpChannels = z.string().transform((v, ctx): readonly z.output<typeof OTP_CHANNEL>[] => {
  const items = v.split(",").map((p) => p.trim());
  const parsed = items.map((p) => OTP_CHANNEL.safeParse(p));
  const channels = parsed.flatMap((r) => (r.success ? [r.data] : []));
  if (channels.length === items.length && new Set(channels).size === channels.length) return channels;
  ctx.addIssue({
    code: z.ZodIssueCode.custom,
    message: "must be a comma-separated list of whatsapp | sms without duplicates",
  });
  return z.NEVER;
});

/** Base64 of exactly 32 bytes (AES-256 key). */
const key32B64 = z
  .string()
  .refine((v) => BASE64.test(v) && Buffer.from(v, "base64").length === 32, "must be base64 of 32 bytes");

/** Base64 that decodes to at least 32 bytes (HMAC key). */
const key32PlusB64 = z
  .string()
  .refine((v) => BASE64.test(v) && Buffer.from(v, "base64").length >= 32, "must be base64 of at least 32 bytes");

/** Contact URL for the push service (RFC 8292): `mailto:` or `https:`. */
const vapidSubject = z
  .string()
  .refine((v) => v.startsWith("mailto:") || v.startsWith("https:"), "must start with mailto: or https:");

const EnvSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    PORT: z.coerce.number().int().default(3001),
    DATABASE_URL: z.string().url(),
    REDIS_URL: z.string().url(),
    WEB_ORIGIN: z.string().url(),
    DEFAULT_ORG_SLUG: z.string().min(1),
    JWT_PRIVATE_KEY_B64: ed25519KeyB64,
    JWT_KEY_ID: z.string().min(1).default("k1"),
    DATA_ENCRYPTION_KEY: key32B64,
    DATA_ENCRYPTION_KEY_ID: z.string().min(1).default("k1"),
    OTP_PROVIDER: z.enum(["twilio", "console", "fake"]).default("console"),
    /** Channels `OtpService.start` tries, in order; SMS only until WhatsApp is enabled on the Verify service. */
    OTP_CHANNELS: otpChannels.default("sms"),
    TWILIO_ACCOUNT_SID: z.string().optional(),
    TWILIO_AUTH_TOKEN: z.string().optional(),
    TWILIO_VERIFY_SERVICE_SID: z.string().optional(),
    EMAIL_PROVIDER: z.enum(["console", "resend"]).default("console"),
    RESEND_API_KEY: z.string().optional(),
    EMAIL_FROM: z.string().optional(),
    COOKIE_SECURE: bool.optional(),
    COOKIE_DOMAIN: z.string().optional(),
    TRUST_PROXY: trustProxy.default("false"),
    /** In-process hold sweeper period; 0 disables it (design call 12). */
    HOLD_SWEEP_INTERVAL_MS: z.coerce.number().int().min(0).default(60000),
    /** HMAC key for stateless manage-link tokens (`notifications/manage-token.ts`); required in every NODE_ENV. */
    MANAGE_LINK_SECRET: key32PlusB64,
    PUSH_PROVIDER: z.enum(["console", "webpush", "fake"]).default("console"),
    VAPID_PUBLIC_KEY: z.string().optional(),
    VAPID_PRIVATE_KEY: z.string().optional(),
    VAPID_SUBJECT: vapidSubject.optional(),
    /** Reminder scan period in the worker; 0 disables it (tests). */
    REMINDER_SCAN_INTERVAL_MS: z.coerce.number().int().min(0).default(60000),
  })
  .superRefine((e, ctx) => {
    const require = (key: keyof typeof e, message: string) => {
      if (e[key] === undefined) ctx.addIssue({ code: z.ZodIssueCode.custom, path: [key], message });
    };
    if (e.OTP_PROVIDER === "fake" && e.NODE_ENV !== "test") {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["OTP_PROVIDER"], message: "fake is only allowed in test" });
    }
    if (e.PUSH_PROVIDER === "fake" && e.NODE_ENV !== "test") {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["PUSH_PROVIDER"], message: "fake is only allowed in test" });
    }
    if (e.NODE_ENV === "production") {
      if (e.OTP_PROVIDER !== "twilio") {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["OTP_PROVIDER"], message: "production requires twilio" });
      }
      if (e.EMAIL_PROVIDER !== "resend") {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["EMAIL_PROVIDER"], message: "production requires resend" });
      }
      if (e.PUSH_PROVIDER !== "webpush") {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["PUSH_PROVIDER"], message: "production requires webpush" });
      }
    }
    if (e.OTP_PROVIDER === "twilio") {
      require("TWILIO_ACCOUNT_SID", "required when OTP_PROVIDER=twilio");
      require("TWILIO_AUTH_TOKEN", "required when OTP_PROVIDER=twilio");
      require("TWILIO_VERIFY_SERVICE_SID", "required when OTP_PROVIDER=twilio");
    }
    if (e.EMAIL_PROVIDER === "resend") {
      require("RESEND_API_KEY", "required when EMAIL_PROVIDER=resend");
      require("EMAIL_FROM", "required when EMAIL_PROVIDER=resend");
    }
    if (e.PUSH_PROVIDER === "webpush") {
      require("VAPID_PUBLIC_KEY", "required when PUSH_PROVIDER=webpush");
      require("VAPID_PRIVATE_KEY", "required when PUSH_PROVIDER=webpush");
      require("VAPID_SUBJECT", "required when PUSH_PROVIDER=webpush");
    }
  })
  .transform((e) => ({ ...e, COOKIE_SECURE: e.COOKIE_SECURE ?? e.NODE_ENV === "production" }));

export type Env = z.output<typeof EnvSchema>;

/**
 * Validates the environment. Empty values (`KEY=` in `.env`) count as unset.
 * The error lists only the offending key names, never their values.
 */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const cleaned = Object.fromEntries(Object.entries(source).filter(([, v]) => v !== undefined && v.trim() !== ""));
  const result = EnvSchema.safeParse(cleaned);
  if (!result.success) {
    const keys = [...new Set(result.error.issues.map((i) => i.path.join(".")))];
    throw new Error(`Invalid environment: ${keys.join(", ")}`);
  }
  return result.data;
}
