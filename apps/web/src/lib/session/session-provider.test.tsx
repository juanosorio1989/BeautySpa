import { ApiError } from "@beautyspa/api-client";
import { act, render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const refresh = vi.fn();
const logout = vi.fn();
const setHandler = vi.fn();
vi.mock("@/lib/api/browser", () => ({
  getBrowserApi: () => ({ auth: { refresh, logout } }),
  setSessionExpiredHandler: (fn: unknown) => setHandler(fn),
}));

import { bookingStore } from "@/lib/booking/store";
import { SessionProvider } from "./session-provider";
import { useSession, type Session } from "./use-session";

function setup(): { current: () => Session } {
  let session!: Session;
  function Probe() {
    session = useSession();
    return null;
  }
  render(
    <SessionProvider>
      <Probe />
    </SessionProvider>,
  );
  return { current: () => session };
}

const unauthorized = () => new ApiError(401, { type: "about:blank", title: "x", status: 401, code: "UNAUTHORIZED" });

describe("SessionProvider", () => {
  beforeEach(() => {
    refresh.mockReset();
    logout.mockReset();
    setHandler.mockReset();
  });

  it("ensure() rejects on a network error and sets status error; a later call retries", async () => {
    refresh.mockRejectedValueOnce(new TypeError("Failed to fetch")).mockResolvedValueOnce({});
    const s = setup();
    await act(async () => {
      await expect(s.current().ensure()).rejects.toBeInstanceOf(TypeError);
    });
    expect(s.current().status).toBe("error");
    await act(async () => {
      expect(await s.current().ensure()).toBe(true);
    });
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("ensure() when signedIn does not refresh again", async () => {
    refresh.mockResolvedValue({});
    const s = setup();
    await act(async () => {
      await s.current().ensure();
    });
    await act(async () => {
      expect(await s.current().ensure()).toBe(true);
    });
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("the registered session-expired handler flips status to signedOut", async () => {
    refresh.mockResolvedValue({});
    const s = setup();
    await act(async () => {
      await s.current().ensure();
    });
    const handler = setHandler.mock.calls.map((c) => c[0]).find((f): f is () => void => typeof f === "function")!;
    act(() => handler());
    expect(s.current().status).toBe("signedOut");
  });

  it("ensure() refreshes once for concurrent callers and reports signedOut on 401", async () => {
    refresh.mockRejectedValue(unauthorized());
    const s = setup();
    let results: boolean[] = [];
    await act(async () => {
      results = await Promise.all([s.current().ensure(), s.current().ensure()]);
    });
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(results).toEqual([false, false]);
    expect(s.current().status).toBe("signedOut");
  });

  it("ensure() reports signedIn on success", async () => {
    refresh.mockResolvedValue({});
    const s = setup();
    await act(async () => {
      expect(await s.current().ensure()).toBe(true);
    });
    expect(s.current().status).toBe("signedIn");
  });

  it("logout() calls auth.logout and clears the booking store", async () => {
    logout.mockResolvedValue(undefined);
    bookingStore.toggleService("00000000-0000-4000-8000-000000000001");
    expect(sessionStorage.getItem("bs-booking")).not.toBeNull();
    const s = setup();
    await act(async () => {
      await s.current().logout();
    });
    expect(logout).toHaveBeenCalledTimes(1);
    expect(sessionStorage.getItem("bs-booking")).toBeNull();
    expect(bookingStore.getState().serviceIds).toEqual([]);
    expect(s.current().status).toBe("signedOut");
  });

  it("logout() failure rethrows, keeps signedIn and leaves the booking store alone", async () => {
    refresh.mockResolvedValue({});
    logout.mockRejectedValue(new TypeError("Failed to fetch"));
    const s = setup();
    await act(async () => {
      await s.current().ensure();
    });
    bookingStore.toggleService("00000000-0000-4000-8000-000000000002");
    await act(async () => {
      await expect(s.current().logout()).rejects.toBeInstanceOf(TypeError);
    });
    expect(s.current().status).toBe("signedIn");
    expect(bookingStore.getState().serviceIds).toContain("00000000-0000-4000-8000-000000000002");
    expect(sessionStorage.getItem("bs-booking")).not.toBeNull();
  });

  it("logout({ local: true }) signs out and clears the store without calling the API", async () => {
    refresh.mockResolvedValue({});
    const s = setup();
    await act(async () => {
      await s.current().ensure();
    });
    bookingStore.toggleService("00000000-0000-4000-8000-000000000003");
    await act(async () => {
      await s.current().logout({ local: true });
    });
    expect(logout).not.toHaveBeenCalled();
    expect(bookingStore.getState().serviceIds).toEqual([]);
    expect(s.current().status).toBe("signedOut");
  });
});
