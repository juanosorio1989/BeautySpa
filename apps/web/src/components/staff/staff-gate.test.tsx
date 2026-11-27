import { ApiError } from "@beautyspa/api-client";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { en } from "@beautyspa/i18n";
import { SessionContext, type Session } from "@/lib/session/use-session";
import { useStaff } from "@/lib/staff/use-staff";

const replace = vi.fn();
let search = new URLSearchParams();
vi.mock("next/navigation", () => ({
  usePathname: () => "/en/staff",
  useSearchParams: () => search,
  useRouter: () => ({ replace, push: vi.fn() }),
}));
vi.mock("next-intl", async (orig) => ({ ...(await orig<typeof import("next-intl")>()), useLocale: () => "en" }));
const me = vi.fn();
const setExpired = vi.fn();
vi.mock("@/lib/api/browser", () => ({
  getBrowserApi: () => ({ staff: { me } }),
  setSessionExpiredHandler: (fn: (() => void) | null) => setExpired(fn),
}));

import { StaffGate } from "./staff-gate";

function Who() {
  return <p>hello {useStaff().name}</p>;
}

function mount(ensure: Session["ensure"]) {
  const session: Session = {
    status: "signedIn",
    ensure,
    signedIn: vi.fn(),
    logout: vi.fn().mockResolvedValue(undefined),
  };
  render(
    <NextIntlClientProvider locale="en" messages={en}>
      <SessionContext.Provider value={session}>
        <StaffGate>
          <Who />
        </StaffGate>
      </SessionContext.Provider>
    </NextIntlClientProvider>,
  );
  return session;
}

const problem = (status: number) =>
  new ApiError(status, { type: "about:blank", title: "x", status, code: "X" } as never);

describe("StaffGate", () => {
  beforeEach(() => {
    search = new URLSearchParams();
    replace.mockReset();
    me.mockReset();
    setExpired.mockReset();
  });
  afterEach(cleanup);

  it("sends signed-out staff to staff login with next", async () => {
    mount(vi.fn().mockResolvedValue(false));
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/en/staff/login?next=%2Fen%2Fstaff"));
    expect(me).not.toHaveBeenCalled();
  });

  it("keeps the query string in next", async () => {
    search = new URLSearchParams("date=2026-12-01");
    mount(vi.fn().mockResolvedValue(false));
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/en/staff/login?next=%2Fen%2Fstaff%3Fdate%3D2026-12-01"));
  });

  it("redirects a customer session with customer=1", async () => {
    me.mockRejectedValue(problem(403));
    mount(vi.fn().mockResolvedValue(true));
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/en/staff/login?next=%2Fen%2Fstaff&customer=1"));
  });

  it("sends a 401 on me to staff login", async () => {
    me.mockRejectedValue(problem(401));
    mount(vi.fn().mockResolvedValue(true));
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/en/staff/login?next=%2Fen%2Fstaff"));
  });

  it("shows children for staff and redirects when the session expires later", async () => {
    me.mockResolvedValue({ id: "1", name: "Ana", email: "a@x.dev", role: "OWNER" });
    const session = mount(vi.fn().mockResolvedValue(true));
    await screen.findByText("hello Ana");
    const handler = setExpired.mock.calls
      .map((c) => c[0])
      .filter(Boolean)
      .at(-1) as () => void;
    act(() => handler());
    expect(replace).toHaveBeenCalledWith("/en/staff/login?next=%2Fen%2Fstaff");
    expect(session.logout).toHaveBeenCalledWith({ local: true });
  });

  it("shows a retry on server errors", async () => {
    me.mockRejectedValueOnce(problem(503)).mockResolvedValueOnce({
      id: "1",
      name: "Ana",
      email: "a@x.dev",
      role: "OWNER",
    });
    mount(vi.fn().mockResolvedValue(true));
    const retry = await screen.findByRole("button", { name: "Try again" });
    act(() => retry.click());
    await screen.findByText("hello Ana");
    expect(replace).not.toHaveBeenCalled();
  });
});
