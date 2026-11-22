import { render, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { en } from "@beautyspa/i18n";
import { bookingStore } from "@/lib/booking/store";
import { emp, id, location, svc } from "@/components/booking/test-fixtures";

const replace = vi.fn();
vi.mock("@/i18n/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace }),
  Link: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}));
let search = "";
vi.mock("next/navigation", () => ({
  useParams: () => ({ locale: "en" }),
  useSearchParams: () => new URLSearchParams(search),
}));

const api = {
  public: {
    locations: vi.fn(),
    services: vi.fn(),
    employees: vi.fn(),
  },
  booking: { availability: vi.fn().mockResolvedValue([]), createHold: vi.fn(), releaseHold: vi.fn() },
};
vi.mock("@/lib/api/browser", () => ({ getBrowserApi: () => api }));

import TimePage from "./page";

const mount = () =>
  render(
    <NextIntlClientProvider locale="en" messages={en}>
      <TimePage />
    </NextIntlClientProvider>,
  );

describe("/book/time", () => {
  beforeEach(() => {
    sessionStorage.clear();
    bookingStore.reset();
    replace.mockReset();
    search = "";
    api.public.locations.mockResolvedValue([location]);
    api.public.services.mockResolvedValue({ categories: [], services: [svc(1)] });
    api.public.employees.mockResolvedValue([emp(11, [id(1)])]);
    api.booking.availability.mockReset().mockResolvedValue([]);
    api.booking.releaseHold.mockReset().mockResolvedValue(undefined);
  });

  it("/book/time without services redirects to step 1", async () => {
    mount();
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/"));
  });

  it("drops stored services missing from the catalog and keeps the rest", async () => {
    bookingStore.toggleService(id(1));
    bookingStore.toggleService(id(77));
    mount();
    await waitFor(() => expect(bookingStore.getState().serviceIds).toEqual([id(1)]));
    expect(replace).not.toHaveBeenCalled();
  });

  it("redirects to step 1 when no stored service exists in the catalog", async () => {
    bookingStore.toggleService(id(77));
    mount();
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/"));
    expect(bookingStore.getState().serviceIds).toEqual([]);
  });

  it("renders the picker when services are chosen", async () => {
    bookingStore.toggleService(id(1));
    const view = mount();
    await waitFor(() => expect(view.getByRole("heading", { name: "Professional and time" })).toBeInTheDocument());
    expect(replace).not.toHaveBeenCalled();
  });

  it("shows the expired-hold message when sent back from details", async () => {
    search = "notice=expired";
    bookingStore.toggleService(id(1));
    const view = mount();
    expect(await view.findByText("Your hold expired. Please pick a time again.")).toBeInTheDocument();
    // the notice is dropped from the URL so a reload does not show it again
    expect(replace).toHaveBeenCalledWith("/book/time");
  });

  it("shows the conflict message with a link to my appointments", async () => {
    search = "notice=conflict";
    bookingStore.toggleService(id(1));
    const view = mount();
    expect(await view.findByText("This time is no longer available.")).toBeInTheDocument();
    expect(view.getByRole("link", { name: "Check my appointments" })).toHaveAttribute("href", "/me");
  });

  it("coming back with a stored hold releases it first, so its own slot shows again", async () => {
    bookingStore.toggleService(id(1));
    bookingStore.setHold({ holdId: "h-own", expiresAt: "2026-11-19T15:05:00.000Z", localExpiresAt: Date.now() + 1 });
    let release!: () => void;
    api.booking.releaseHold.mockReturnValue(new Promise<void>((resolve) => (release = resolve)));
    mount();
    await waitFor(() => expect(api.booking.releaseHold).toHaveBeenCalledWith("h-own"));
    expect(bookingStore.getState().hold).toBeNull();
    await waitFor(() => expect(api.public.services).toHaveBeenCalled());
    expect(api.booking.availability).not.toHaveBeenCalled();
    release();
    await waitFor(() => expect(api.booking.availability).toHaveBeenCalled());
    expect(api.booking.releaseHold).toHaveBeenCalledTimes(1);
  });

  it("a failed release still clears the hold and loads availability", async () => {
    bookingStore.toggleService(id(1));
    bookingStore.setHold({ holdId: "h-own", expiresAt: "2026-11-19T15:05:00.000Z", localExpiresAt: Date.now() + 1 });
    api.booking.releaseHold.mockRejectedValue(new TypeError("offline"));
    mount();
    await waitFor(() => expect(api.booking.availability).toHaveBeenCalled());
    expect(bookingStore.getState().hold).toBeNull();
  });
});
