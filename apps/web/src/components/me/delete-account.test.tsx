import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { en } from "@beautyspa/i18n";
import { SessionContext, type Session } from "@/lib/session/use-session";

let pushImpl: () => Promise<void> = async () => undefined;
vi.mock("@/lib/push", () => ({ dropPushSubscription: () => pushImpl() }));
const remove = vi.fn();
vi.mock("@/lib/api/browser", () => ({ getBrowserApi: () => ({ me: { remove } }) }));
vi.mock("@/i18n/navigation", () => ({ useRouter: () => ({ replace: vi.fn() }) }));

import { DeleteAccount } from "./delete-account";

function mount(logout: Session["logout"]) {
  const session: Session = {
    status: "signedIn",
    ensure: vi.fn().mockResolvedValue(true),
    signedIn: vi.fn(),
    logout,
  };
  render(
    <NextIntlClientProvider locale="en" messages={en}>
      <SessionContext.Provider value={session}>
        <DeleteAccount />
      </SessionContext.Provider>
    </NextIntlClientProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: en.profile.delete }));
  fireEvent.click(screen.getByRole("button", { name: en.profile.deleteConfirm }));
}

describe("DeleteAccount push cleanup", () => {
  beforeEach(() => {
    pushImpl = async () => undefined;
    remove.mockReset().mockResolvedValue(undefined);
  });
  afterEach(cleanup);

  it("drops the push subscription before deleting the account", async () => {
    const order: string[] = [];
    pushImpl = async () => void order.push("push");
    remove.mockImplementation(async () => void order.push("delete"));
    const logout = vi.fn().mockResolvedValue(undefined);
    mount(logout);
    await waitFor(() => expect(logout).toHaveBeenCalled());
    expect(order).toEqual(["push", "delete"]);
  });

  it("deletes even when the cleanup fails", async () => {
    pushImpl = () => Promise.reject(new Error("offline"));
    const logout = vi.fn().mockResolvedValue(undefined);
    mount(logout);
    await waitFor(() => expect(logout).toHaveBeenCalled());
    expect(remove).toHaveBeenCalled();
  });
});
