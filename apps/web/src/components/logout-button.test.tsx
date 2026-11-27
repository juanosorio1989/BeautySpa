import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { en } from "@beautyspa/i18n";
import { SessionContext, type Session } from "@/lib/session/use-session";

// A plain function behind the mock: vitest's spy flags a rejection it wraps even when the caller handles it.
let pushImpl: () => Promise<void> = async () => undefined;
vi.mock("@/lib/push", () => ({ dropPushSubscription: () => pushImpl() }));
const replace = vi.fn();
vi.mock("@/i18n/navigation", () => ({ useRouter: () => ({ replace }) }));

import { LogoutButton } from "./logout-button";

function mount(logout: Session["logout"], redirectTo?: "/staff/login") {
  const session: Session = {
    status: "signedIn",
    ensure: vi.fn().mockResolvedValue(true),
    signedIn: vi.fn(),
    logout,
  };
  render(
    <NextIntlClientProvider locale="en" messages={en}>
      <SessionContext.Provider value={session}>
        <LogoutButton redirectTo={redirectTo} />
      </SessionContext.Provider>
    </NextIntlClientProvider>,
  );
}

describe("LogoutButton push cleanup", () => {
  beforeEach(() => {
    pushImpl = async () => undefined;
  });
  afterEach(cleanup);

  it("drops the push subscription before logging out", async () => {
    const order: string[] = [];
    pushImpl = async () => void order.push("push");
    const logout = vi.fn(async () => void order.push("logout"));
    mount(logout);
    fireEvent.click(screen.getByRole("button", { name: "Log out" }));
    await waitFor(() => expect(logout).toHaveBeenCalled());
    expect(order).toEqual(["push", "logout"]);
  });

  it("logs out even when the cleanup fails", async () => {
    pushImpl = () => Promise.reject(new Error("offline"));
    const logout = vi.fn().mockResolvedValue(undefined);
    mount(logout);
    fireEvent.click(screen.getByRole("button", { name: "Log out" }));
    await waitFor(() => expect(logout).toHaveBeenCalled());
  });

  it("goes to redirectTo after logging out", async () => {
    mount(vi.fn().mockResolvedValue(undefined), "/staff/login");
    fireEvent.click(screen.getByRole("button", { name: "Log out" }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/staff/login"));
  });
});
