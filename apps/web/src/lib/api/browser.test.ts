import { afterEach, describe, expect, it, vi } from "vitest";

const create = vi.fn((opts: unknown) => opts);
vi.mock("@beautyspa/api-client", () => ({
  createApiClient: (o: unknown) => create(o),
  createCookieTokenStore: () => ({}),
}));

import { getBrowserApi } from "./browser";

describe("getBrowserApi", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("refreshLock falls back to calling fn when navigator.locks is undefined", async () => {
    const opts = getBrowserApi() as unknown as { refreshLock: <T>(fn: () => Promise<T>) => Promise<T> };
    vi.stubGlobal("navigator", {});
    const fn = vi.fn().mockResolvedValue("ok");
    await expect(opts.refreshLock(fn)).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("refreshLock uses navigator.locks when present", async () => {
    const opts = getBrowserApi() as unknown as { refreshLock: <T>(fn: () => Promise<T>) => Promise<T> };
    const request = vi.fn((_n: string, cb: () => Promise<string>) => cb());
    vi.stubGlobal("navigator", { locks: { request } });
    await expect(opts.refreshLock(() => Promise.resolve("ok"))).resolves.toBe("ok");
    expect(request).toHaveBeenCalledWith("bs-refresh", expect.any(Function));
  });
});
