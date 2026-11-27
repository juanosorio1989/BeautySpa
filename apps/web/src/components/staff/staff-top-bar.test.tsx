import type { StaffMe } from "@beautyspa/contracts";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import { en } from "@beautyspa/i18n";
import { SessionContext, type Session } from "@/lib/session/use-session";
import { StaffContext } from "@/lib/staff/use-staff";

const replace = vi.fn();
vi.mock("@/i18n/navigation", () => ({
  useRouter: () => ({ replace }),
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("@/components/locale-switch", () => ({ LocaleSwitch: () => null }));
vi.mock("@/lib/push", () => ({ dropPushSubscription: () => Promise.resolve() }));
vi.mock("@/lib/api/browser", () => ({
  getBrowserApi: () => ({ public: { locations: () => Promise.resolve([{ name: "Spa One" }]) } }),
}));

import { StaffTopBar } from "./staff-top-bar";

function mount(role: StaffMe["role"]) {
  const session: Session = {
    status: "signedIn",
    ensure: vi.fn().mockResolvedValue(true),
    signedIn: vi.fn(),
    logout: vi.fn().mockResolvedValue(undefined),
  };
  render(
    <NextIntlClientProvider locale="en" messages={en}>
      <SessionContext.Provider value={session}>
        <StaffContext.Provider value={{ id: "1", name: "Ana", email: "a@x.dev", role }}>
          <StaffTopBar />
        </StaffContext.Provider>
      </SessionContext.Provider>
    </NextIntlClientProvider>,
  );
  return session;
}

describe("StaffTopBar", () => {
  afterEach(cleanup);

  it("hides Clients from EMPLOYEE and logs out to staff login", async () => {
    const session = mount("EMPLOYEE");
    expect(screen.queryByRole("link", { name: "Clients" })).toBeNull();
    await screen.findByText("Spa One");
    fireEvent.click(screen.getByRole("button", { name: "Log out" }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/staff/login"));
    expect(session.logout).toHaveBeenCalled();
  });

  it("shows Clients to RECEPTION", () => {
    mount("RECEPTION");
    expect(screen.getByRole("link", { name: "Clients" })).toBeInTheDocument();
  });
});
