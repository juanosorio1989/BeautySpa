import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { decodeBase64Url, disablePush, enablePush, getPushSupport } from "./push";

const UA_DESKTOP = "Mozilla/5.0 (X11; Linux x86_64) Chrome/130";
const UA_IOS = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari/604.1";

const subscription = {
  endpoint: "https://push.example/abc",
  toJSON: () => ({ endpoint: "https://push.example/abc", keys: { p256dh: "P", auth: "A" } }),
  unsubscribe: vi.fn(async () => true),
};
const pushManager = { getSubscription: vi.fn(), subscribe: vi.fn() };
const registration = { pushManager };
const api = {
  push: {
    publicKey: vi.fn(),
    subscribe: vi.fn(),
    unsubscribe: vi.fn(),
  },
};
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const pushApi = api as any;

function stub(opts: { ua?: string; push?: boolean; permission?: string; standalone?: boolean } = {}) {
  vi.stubGlobal("navigator", {
    userAgent: opts.ua ?? UA_DESKTOP,
    maxTouchPoints: 0,
    serviceWorker: { register: vi.fn(async () => registration), getRegistration: vi.fn(async () => registration) },
  });
  if (opts.push !== false) vi.stubGlobal("PushManager", class {});
  else vi.stubGlobal("PushManager", undefined);
  if (opts.push === false) delete (window as unknown as Record<string, unknown>).PushManager;
  vi.stubGlobal("Notification", {
    permission: opts.permission ?? "default",
    requestPermission: vi.fn(async () => "granted"),
  });
  vi.stubGlobal("matchMedia", () => ({ matches: opts.standalone === true }));
}

beforeEach(() => {
  api.push.publicKey.mockReset().mockResolvedValue({ publicKey: "AQID_w" });
  api.push.subscribe.mockReset().mockResolvedValue(undefined);
  api.push.unsubscribe.mockReset().mockResolvedValue(undefined);
  pushManager.getSubscription.mockReset().mockResolvedValue(null);
  pushManager.subscribe.mockReset().mockResolvedValue(subscription);
  subscription.unsubscribe.mockClear();
});
afterEach(() => vi.unstubAllGlobals());

describe("getPushSupport", () => {
  it("unsupported without PushManager", async () => {
    stub({ push: false });
    expect(await getPushSupport(pushApi)).toBe("unsupported");
  });

  it("unsupported when the server has no VAPID key", async () => {
    stub();
    api.push.publicKey.mockRejectedValue(new Error("404"));
    expect(await getPushSupport(pushApi)).toBe("unsupported");
  });

  it("needs-install on iOS Safari not standalone", async () => {
    stub({ ua: UA_IOS, push: false });
    expect(await getPushSupport(pushApi)).toBe("needs-install");
  });

  it("is available on an installed iOS app", async () => {
    stub({ ua: UA_IOS, standalone: true });
    expect(await getPushSupport(pushApi)).toBe("available");
  });

  it("denied when permission denied", async () => {
    stub({ permission: "denied" });
    expect(await getPushSupport(pushApi)).toBe("denied");
  });

  it("available without a subscription, subscribed with one", async () => {
    stub();
    expect(await getPushSupport(pushApi)).toBe("available");
    pushManager.getSubscription.mockResolvedValue(subscription);
    expect(await getPushSupport(pushApi)).toBe("subscribed");
  });
});

describe("enablePush / disablePush", () => {
  it("enablePush subscribes with decoded key and posts BOOKING_FORM", async () => {
    stub();
    expect(await enablePush(pushApi, "BOOKING_FORM")).toBe("subscribed");
    const call = pushManager.subscribe.mock.calls[0]![0] as {
      userVisibleOnly: boolean;
      applicationServerKey: Uint8Array;
    };
    expect(call.userVisibleOnly).toBe(true);
    expect([...call.applicationServerKey]).toEqual([1, 2, 3, 255]);
    expect(api.push.subscribe).toHaveBeenCalledWith({
      endpoint: "https://push.example/abc",
      keys: { p256dh: "P", auth: "A" },
      consentSource: "BOOKING_FORM",
    });
  });

  it("enablePush asks for permission before registering the worker", async () => {
    stub();
    const order: string[] = [];
    (navigator.serviceWorker.register as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      order.push("register");
      return registration;
    });
    vi.stubGlobal("Notification", {
      permission: "default",
      requestPermission: vi.fn(async () => {
        order.push("permission");
        return "granted";
      }),
    });
    await enablePush(pushApi, "PROFILE");
    expect(order).toEqual(["permission", "register"]);
  });

  it("enablePush drops the browser subscription when the API call fails", async () => {
    stub();
    api.push.subscribe.mockRejectedValue(new Error("boom"));
    await expect(enablePush(pushApi, "PROFILE")).rejects.toThrow("boom");
    expect(subscription.unsubscribe).toHaveBeenCalled();
  });

  it("getPushSupport looks up the registration at scope /", async () => {
    stub();
    await getPushSupport(pushApi);
    expect(navigator.serviceWorker.getRegistration).toHaveBeenCalledWith("/");
  });

  it("enablePush does not subscribe when permission is refused", async () => {
    stub();
    vi.stubGlobal("Notification", { permission: "default", requestPermission: vi.fn(async () => "denied") });
    expect(await enablePush(pushApi, "PROFILE")).toBe("denied");
    expect(api.push.subscribe).not.toHaveBeenCalled();
  });

  it("disablePush unsubscribes both", async () => {
    stub();
    pushManager.getSubscription.mockResolvedValue(subscription);
    await disablePush(pushApi);
    expect(subscription.unsubscribe).toHaveBeenCalled();
    expect(api.push.unsubscribe).toHaveBeenCalledWith({ endpoint: "https://push.example/abc" });
  });

  it("decodes base64url", () => {
    expect([...decodeBase64Url("AQID_w")]).toEqual([1, 2, 3, 255]);
  });
});
