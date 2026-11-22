import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { getPrimaryLocation, revalidatingFetch } from "./server";

describe("revalidatingFetch", () => {
  it("passes next.revalidate", async () => {
    const spy = vi.fn().mockResolvedValue({ status: 200 });
    vi.stubGlobal("fetch", spy);
    await revalidatingFetch(60)("http://x/v1/a", { method: "GET", headers: { accept: "application/json" } });
    expect(spy).toHaveBeenCalledWith("http://x/v1/a", {
      method: "GET",
      headers: { accept: "application/json" },
      next: { revalidate: 60 },
    });
    vi.unstubAllGlobals();
  });
});

describe("getPrimaryLocation", () => {
  it("returns undefined and logs when the API is unreachable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(getPrimaryLocation()).resolves.toBeUndefined();
    expect(log).toHaveBeenCalledOnce();
    log.mockRestore();
    vi.unstubAllGlobals();
  });
});
