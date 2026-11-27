import { ApiError } from "@beautyspa/api-client";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import { en } from "@beautyspa/i18n";
import { PEDI, appointment, catalog, id } from "./test-fixtures";

vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams() }));
vi.mock("@/i18n/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const walkInFn = vi.fn();
vi.mock("@/lib/api/browser", () => ({
  getBrowserApi: () => ({
    public: {
      locations: () =>
        Promise.resolve([{ id: id(50), timezone: "America/New_York", booking: { bookingHorizonDays: 30 } }]),
    },
    staff: { bookingCatalog: () => Promise.resolve(catalog), walkIn: walkInFn, searchCustomers: vi.fn() },
  }),
}));

import { WalkIn } from "./walk-in";

function mount() {
  render(
    <NextIntlClientProvider locale="en" messages={en}>
      <WalkIn />
    </NextIntlClientProvider>,
  );
}

describe("WalkIn", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("walk-in without client sends customerId null", async () => {
    walkInFn.mockResolvedValue(appointment());
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Skip" }));
    const group = await screen.findByRole("group", { name: "Services" });
    fireEvent.click(group.querySelector("button")!);
    fireEvent.click(screen.getByRole("button", { name: "Start now" }));
    await waitFor(() => expect(walkInFn).toHaveBeenCalled());
    expect(walkInFn).toHaveBeenCalledWith({ customerId: null, services: [{ serviceId: PEDI, employeeId: "ANY" }] });
    expect(await screen.findByText(/Ana · 10:00 AM/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open the agenda" })).toHaveAttribute(
      "href",
      `/staff?date=2026-12-01&highlight=${id(100)}`,
    );
  });

  it("walk-in SLOT_TAKEN shows no one free", async () => {
    walkInFn.mockRejectedValue(new ApiError(409, { type: "about:blank", title: "x", status: 409, code: "SLOT_TAKEN" }));
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Skip" }));
    const group = await screen.findByRole("group", { name: "Services" });
    fireEvent.click(group.querySelector("button")!);
    fireEvent.click(screen.getByRole("button", { name: "Start now" }));
    expect(await screen.findByText("No one is free right now.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Book a time instead" })).toHaveAttribute("href", "/staff/book");
  });
});
