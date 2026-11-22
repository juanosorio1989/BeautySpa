import { ApiError } from "@beautyspa/api-client";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { en } from "@beautyspa/i18n";
import { bookingStore } from "@/lib/booking/store";
import { emp, id, location, seg, slot, svc } from "./test-fixtures";

const push = vi.fn();
vi.mock("@/i18n/navigation", () => ({
  useRouter: () => ({ push, replace: vi.fn() }),
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const availability = vi.fn();
const createHold = vi.fn();
const releaseHold = vi.fn();
vi.mock("@/lib/api/browser", () => ({
  getBrowserApi: () => ({ booking: { availability, createHold, releaseHold } }),
}));

import { TimePicker } from "./time-picker";

const services = [svc(1), svc(2)];
const employees = [emp(11, [id(1), id(2)]), emp(12, [id(2)]), emp(13, [id(99)])];
const choices = [
  { serviceId: id(1), employeeId: "ANY" as const },
  { serviceId: id(2), employeeId: "ANY" as const },
];
// Local 2026-11-19 in America/New_York (UTC-5): 11:00 local = 16:00Z.
const slotA = slot("2026-11-19T16:00:00.000Z", "2026-11-19T16:45:00.000Z", [
  seg(1, 11, "2026-11-19T16:00:00.000Z", "2026-11-19T16:30:00.000Z", 2500),
  seg(2, 12, "2026-11-19T16:00:00.000Z", "2026-11-19T16:45:00.000Z", 4100),
]);
const slotB = slot("2026-11-19T16:15:00.000Z", "2026-11-19T17:00:00.000Z");
const apiError = (status: number, code: "SLOT_TAKEN" | "RATE_LIMITED") =>
  new ApiError(status, { type: "about:blank", title: "x", status, code });

const mount = (props: Partial<React.ComponentProps<typeof TimePicker>> = {}) => {
  const onDateChange = vi.fn();
  const onChoiceChange = vi.fn();
  render(
    <NextIntlClientProvider locale="en" messages={en}>
      <TimePicker
        locale="en"
        location={location}
        services={services}
        employees={employees}
        choices={choices}
        onChoiceChange={onChoiceChange}
        date="2026-11-19"
        onDateChange={onDateChange}
        {...props}
      />
    </NextIntlClientProvider>,
  );
  return { onDateChange, onChoiceChange };
};

describe("TimePicker", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"], now: Date.parse("2026-11-19T15:00:00Z") });
    sessionStorage.clear();
    bookingStore.reset();
    for (const f of [push, availability, createHold, releaseHold]) f.mockReset();
    releaseHold.mockResolvedValue(undefined);
  });
  afterEach(() => vi.useRealTimers());

  it("queries availability with choices and excludeAppointmentId, in the location timezone", async () => {
    availability.mockResolvedValue([slotA, slotB]);
    mount({ excludeAppointmentId: id(500) });
    expect(await screen.findByRole("button", { name: /^11:00\sAM$/ })).toBeInTheDocument();
    expect(availability).toHaveBeenCalledWith({
      locationId: location.id,
      services: choices,
      date: "2026-11-19",
      excludeAppointmentId: id(500),
    });
    expect(screen.getByRole("button", { name: /^11:15\sAM$/ })).toBeInTheDocument();
  });

  it("offers Any plus only the professionals who do the service, and reports a change", async () => {
    availability.mockResolvedValue([slotA]);
    const { onChoiceChange } = mount();
    await screen.findByRole("button", { name: /^11:00\sAM$/ });
    const group = screen.getByRole("group", { name: "Svc 2" });
    expect(group).toHaveTextContent("Any");
    expect(group).toHaveTextContent("Emp 12");
    expect(screen.getByRole("group", { name: "Svc 1" })).not.toHaveTextContent("Emp 12");
    expect(group).not.toHaveTextContent("Emp 13");
    fireEvent.click(screen.getByRole("group", { name: "Svc 2" }).querySelectorAll("button")[2]!);
    expect(onChoiceChange).toHaveBeenCalledWith(id(2), id(12));
  });

  it("shows the summary with exact prices and the parallel hint for a picked slot", async () => {
    availability.mockResolvedValue([slotA]);
    mount();
    fireEvent.click(await screen.findByRole("button", { name: /^11:00\sAM$/ }));
    expect(screen.getByText(en.booking.time.parallelHint)).toBeInTheDocument();
    expect(screen.getByText("Svc 1 with Emp 11 · $25.00")).toBeInTheDocument();
    expect(screen.getByText("Svc 2 with Emp 12 · $41.00")).toBeInTheDocument();
    expect(screen.getByText("Total $66.00")).toBeInTheDocument();
    expect(screen.getByText(/11:00\sAM\s–\s11:45\sAM/)).toBeInTheDocument();
  });

  it("holds the slot, stores it and goes to details", async () => {
    availability.mockResolvedValue([slotA]);
    createHold.mockResolvedValue({ holdId: "h1", expiresAt: "2026-11-19T15:05:00.000Z" });
    mount();
    fireEvent.click(await screen.findByRole("button", { name: /^11:00\sAM$/ }));
    fireEvent.click(screen.getByRole("button", { name: "Hold this time" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/book/details"));
    expect(createHold).toHaveBeenCalledWith({ locationId: location.id, segments: slotA.segments });
    expect(bookingStore.getState().hold?.holdId).toBe("h1");
    expect(bookingStore.getState().slot?.startsAt).toBe(slotA.startsAt);
  });

  it("time picker refetches slots and shows a notice on SLOT_TAKEN", async () => {
    availability.mockResolvedValue([slotA]);
    createHold.mockRejectedValue(apiError(409, "SLOT_TAKEN"));
    mount();
    fireEvent.click(await screen.findByRole("button", { name: /^11:00\sAM$/ }));
    fireEvent.click(screen.getByRole("button", { name: "Hold this time" }));
    expect(await screen.findByText(en.booking.time.slotTaken)).toBeInTheDocument();
    await waitFor(() => expect(availability).toHaveBeenCalledTimes(2));
    expect(push).not.toHaveBeenCalled();
  });

  it("shows the rate-limit message when holding is throttled", async () => {
    availability.mockResolvedValue([slotA]);
    createHold.mockRejectedValue(apiError(429, "RATE_LIMITED"));
    mount();
    fireEvent.click(await screen.findByRole("button", { name: /^11:00\sAM$/ }));
    fireEvent.click(screen.getByRole("button", { name: "Hold this time" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(en.errors.RATE_LIMITED);
  });

  it("shows RATE_LIMITED when availability is throttled", async () => {
    availability.mockRejectedValue(apiError(429, "RATE_LIMITED"));
    mount();
    expect(await screen.findByRole("alert")).toHaveTextContent(en.errors.RATE_LIMITED);
  });

  it("uses a custom onPick instead of holding", async () => {
    availability.mockResolvedValue([slotA]);
    const onPick = vi.fn().mockResolvedValue(undefined);
    mount({ onPick, pickLabel: "Confirm new time" });
    fireEvent.click(await screen.findByRole("button", { name: /^11:00\sAM$/ }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm new time" }));
    await waitFor(() => expect(onPick).toHaveBeenCalledWith(slotA));
    expect(createHold).not.toHaveBeenCalled();
  });

  it("empty day shows 'next day with times', which queries following days up to 14 or the horizon", async () => {
    availability.mockImplementation(async ({ date }: { date: string }) => (date === "2026-11-22" ? [slotB] : []));
    const { onDateChange } = mount();
    expect(await screen.findByText(en.booking.time.noTimes)).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Next day with times" }));
    });
    await waitFor(() => expect(onDateChange).toHaveBeenCalledWith("2026-11-22"));
    expect(availability.mock.calls.map((c) => c[0].date)).toEqual([
      "2026-11-19",
      "2026-11-20",
      "2026-11-21",
      "2026-11-22",
    ]);
  });

  it("stops the next-day search after 14 days", async () => {
    availability.mockResolvedValue([]);
    const { onDateChange } = mount();
    await screen.findByText(en.booking.time.noTimes);
    fireEvent.click(screen.getByRole("button", { name: "Next day with times" }));
    expect(await screen.findByText(en.booking.time.noNextDay)).toBeInTheDocument();
    expect(availability).toHaveBeenCalledTimes(1 + 14);
    expect(onDateChange).not.toHaveBeenCalled();
  });

  it("stops the next-day search at the booking horizon", async () => {
    availability.mockResolvedValue([]);
    mount({ location: { ...location, booking: { ...location.booking, bookingHorizonDays: 3 } } });
    await screen.findByText(en.booking.time.noTimes);
    fireEvent.click(screen.getByRole("button", { name: "Next day with times" }));
    expect(await screen.findByText(en.booking.time.noNextDay)).toBeInTheDocument();
    expect(availability).toHaveBeenCalledTimes(1 + 2);
  });

  it("renders the date strip from today through the horizon", async () => {
    availability.mockResolvedValue([]);
    mount();
    await screen.findByText(en.booking.time.noTimes);
    const strip = screen.getByRole("group", { name: "Date" });
    expect(strip.querySelectorAll("button")).toHaveLength(30);
    expect(strip.querySelectorAll("button")[0]).toHaveTextContent("Today");
  });
});
