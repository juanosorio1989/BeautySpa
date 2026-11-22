import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it, vi } from "vitest";
import { en } from "@beautyspa/i18n";
import { SiteHeader } from "./site-header";

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
        <SiteHeader locationName="Demo Salon" />
      </NextIntlClientProvider>,
    );
    expect(screen.getByText("Demo Salon")).toBeInTheDocument();
    for (const label of [en.nav.services, en.nav.team, en.nav.location, en.nav.myAppointments]) {
      expect(screen.getByRole("link", { name: label })).toBeInTheDocument();
    }
  });
});
