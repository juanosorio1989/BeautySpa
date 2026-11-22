import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it, vi } from "vitest";
import { en } from "@beautyspa/i18n";
import { SessionContext, type Session } from "@/lib/session/use-session";
import { SiteHeader } from "./site-header";

const replace = vi.fn();
vi.mock("@/i18n/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/i18n/navigation")>()),
  useRouter: () => ({ push: vi.fn(), replace, prefetch: vi.fn() }),
}));

const session = (status: Session["status"], logout = vi.fn().mockResolvedValue(undefined)): Session => ({
  status,
  ensure: vi.fn(),
  signedIn: vi.fn(),
  logout,
});

vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  usePathname: () => "/en",
  useParams: () => ({ locale: "en" }),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
}));

describe("SiteHeader", () => {
  it("renders the location name and the four nav labels from the catalog", () => {
    render(
      <NextIntlClientProvider locale="en" messages={en}>
        <SessionContext.Provider value={session("signedOut")}>
          <SiteHeader locationName="Demo Salon" />
        </SessionContext.Provider>
      </NextIntlClientProvider>,
    );
    expect(screen.getByText("Demo Salon")).toBeInTheDocument();
    for (const label of [en.nav.services, en.nav.team, en.nav.location, en.nav.myAppointments]) {
      expect(screen.getByRole("link", { name: label })).toBeInTheDocument();
    }
  });

  it("shows Log out only when signed in; it logs out and goes home", async () => {
    const logout = vi.fn().mockResolvedValue(undefined);
    const view = render(
      <NextIntlClientProvider locale="en" messages={en}>
        <SessionContext.Provider value={session("signedOut")}>
          <SiteHeader locationName="Demo Salon" />
        </SessionContext.Provider>
      </NextIntlClientProvider>,
    );
    expect(screen.queryByRole("button", { name: "Log out" })).not.toBeInTheDocument();
    view.unmount();
    render(
      <NextIntlClientProvider locale="en" messages={en}>
        <SessionContext.Provider value={session("signedIn", logout)}>
          <SiteHeader locationName="Demo Salon" />
        </SessionContext.Provider>
      </NextIntlClientProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Log out" }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/"));
    expect(logout).toHaveBeenCalled();
  });
});
