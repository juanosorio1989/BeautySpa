import type { ApiClient } from "@beautyspa/api-client";
import { getBrowserApi } from "@/lib/api/browser";

export type PushSupport = "unsupported" | "needs-install" | "denied" | "available" | "subscribed";
export type PushConsentSource = "PROFILE" | "BOOKING_FORM";
type PushApi = Pick<ApiClient, "push">;

function isIos(): boolean {
  const ua = navigator.userAgent;
  return /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}

function isStandalone(): boolean {
  const nav = navigator as Navigator & { standalone?: boolean };
  return nav.standalone === true || window.matchMedia?.("(display-mode: standalone)").matches === true;
}

function hasPushApis(): boolean {
  return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

/** base64url -> bytes, the form `applicationServerKey` wants. */
export function decodeBase64Url(value: string): Uint8Array<ArrayBuffer> {
  const base64 = value
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .padEnd(Math.ceil(value.length / 4) * 4, "=");
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

async function currentSubscription(): Promise<PushSubscription | null> {
  const registration = await navigator.serviceWorker.getRegistration("/");
  return registration ? await registration.pushManager.getSubscription() : null;
}

const REPOSTED_PREFIX = "bs-push-reposted:";
const PUSH_CLEANUP_MS = 2000;

function wasReposted(endpoint: string): boolean {
  try {
    return sessionStorage.getItem(REPOSTED_PREFIX + endpoint) !== null;
  } catch {
    return false; // storage blocked (private mode): post
  }
}

function markReposted(endpoint: string): void {
  try {
    sessionStorage.setItem(REPOSTED_PREFIX + endpoint, "1");
  } catch {
    // ignored on purpose
  }
}

function clearReposted(endpoint: string): void {
  try {
    sessionStorage.removeItem(REPOSTED_PREFIX + endpoint);
  } catch {
    // ignored on purpose
  }
}

async function postSubscription(api: PushApi, subscription: PushSubscription, consentSource: PushConsentSource) {
  const json = subscription.toJSON();
  await api.push.subscribe({
    endpoint: subscription.endpoint,
    keys: { p256dh: json.keys?.p256dh ?? "", auth: json.keys?.auth ?? "" },
    consentSource,
  });
}

/**
 * What the toggle should offer on this device. Never throws. "subscribed" needs both a browser
 * subscription and the customer's PUSH consent; with both, the subscription is re-sent to the API
 * (idempotent upsert) so a lost server row heals.
 */
export async function getPushSupport(
  api: PushApi,
  opts: { pushConsent: boolean; consentSource: PushConsentSource },
): Promise<PushSupport> {
  try {
    // iOS Safari has no PushManager until the site is added to the home screen, so check this first.
    if (isIos() && !isStandalone()) return "needs-install";
    if (!hasPushApis()) return "unsupported";
    await api.push.publicKey(); // 404: the server has no VAPID key
    if (Notification.permission === "denied") return "denied";
    const subscription = await currentSubscription();
    if (!subscription || !opts.pushConsent) return "available";
    // Re-send at most once per browser session per endpoint; marked only after a successful POST.
    if (!wasReposted(subscription.endpoint)) {
      await postSubscription(api, subscription, opts.consentSource).then(
        () => markReposted(subscription.endpoint),
        () => undefined,
      );
    }
    return "subscribed";
  } catch {
    return "unsupported";
  }
}

/** Must run from a tap: it asks for permission. Returns the resulting state. */
export async function enablePush(api: PushApi, consentSource: PushConsentSource): Promise<PushSupport> {
  if (!hasPushApis()) return "unsupported";
  // First await: registering the worker first would use up the tap's transient user activation.
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return permission === "denied" ? "denied" : "available";
  await navigator.serviceWorker.register("/sw.js");
  // `subscribe()` needs an active worker; `register()` can resolve before it is.
  const registration = await navigator.serviceWorker.ready;
  const { publicKey } = await api.push.publicKey();
  const subscription =
    (await registration.pushManager.getSubscription()) ??
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: decodeBase64Url(publicKey),
    }));
  try {
    await postSubscription(api, subscription, consentSource);
  } catch (err) {
    // Keep the browser and the server in step: no server row, no browser subscription.
    await subscription.unsubscribe().catch(() => false);
    throw err;
  }
  return "subscribed";
}

/** Drops this device's subscription in the browser and on the API. */
export async function disablePush(api: PushApi): Promise<void> {
  const subscription = await currentSubscription();
  if (!subscription) return;
  const endpoint = subscription.endpoint;
  clearReposted(endpoint);
  await subscription.unsubscribe();
  await api.push.unsubscribe({ endpoint });
}

/** Best effort: drop this device's push subscription before signing out; never fails, waits at most ~2 s. */
export async function dropPushSubscription(): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      disablePush(getBrowserApi()),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, PUSH_CLEANUP_MS);
      }),
    ]);
  } catch {
    // ignored on purpose
  } finally {
    clearTimeout(timer);
  }
}
