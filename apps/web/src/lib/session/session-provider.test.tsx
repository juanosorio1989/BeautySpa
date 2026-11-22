import { ApiError } from "@beautyspa/api-client";
import { act, render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const refresh = vi.fn();
const logout = vi.fn();
vi.mock("@/lib/api/browser", () => ({
  getBrowserApi: () => ({ auth: { refresh, logout } }),
  setSessionExpiredHandler: vi.fn(),
}));

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
    sessionStorage.setItem("bs-booking", "{}");
    const s = setup();
    await act(async () => {
      await s.current().logout();
    });
    expect(logout).toHaveBeenCalledTimes(1);
    expect(sessionStorage.getItem("bs-booking")).toBeNull();
    expect(s.current().status).toBe("signedOut");
  });
});
