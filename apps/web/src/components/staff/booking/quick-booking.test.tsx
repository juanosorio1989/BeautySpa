import { ApiError } from "@beautyspa/api-client";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { en } from "@beautyspa/i18n";
import { ANA, BEA, CUSTOMER, PEDI, appointment, catalog, client, id, slot } from "./test-fixtures";

let searchParams = new URLSearchParams("date=2026-12-01");
const push = vi.fn();
vi.mock("next/navigation", () => ({ useSearchParams: () => searchParams }));
vi.mock("@/i18n/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push }),
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const searchCustomers = vi.fn();
const createCustomer = vi.fn();
const customer = vi.fn();
const availability = vi.fn();
const createAppointment = vi.fn();
vi.mock("@/lib/api/browser", () => ({
  getBrowserApi: () => ({
    public: {
      locations: () =>
        Promise.resolve([{ id: id(50), timezone: "America/New_York", booking: { bookingHorizonDays: 30 } }]),
    },
    staff: {
      searchCustomers,
      createCustomer,
      customer,
      bookingCatalog: () => Promise.resolve(catalog),
      availability,
      createAppointment,
    },
  }),
}));

import { QuickBooking } from "./quick-booking";

// 10:00, 10:15, 10:30, 10:45 in New York on 2026-12-01
const T = (hhmm: string) => `2026-12-01T${hhmm}:00.000Z`;
const normal = [slot(T("15:00")), slot(T("15:15"), BEA), slot(T("15:30")), slot(T("15:45"))];

let taps = 0;
const tap = (el: HTMLElement) => {
  taps += 1;
  fireEvent.click(el);
};

function mount() {
  render(
    <NextIntlClientProvider locale="en" messages={en}>
      <QuickBooking />
    </NextIntlClientProvider>,
  );
}

async function pickClient(c = client()) {
  searchCustomers.mockResolvedValue([c]);
  fireEvent.change(await screen.findByLabelText("Phone or name"), { target: { value: "718 555" } });
  const row = await screen.findByRole("button", { name: /Maria Lopez/ });
  tap(row);
}

describe("QuickBooking", () => {
  beforeEach(() => {
    taps = 0;
    searchParams = new URLSearchParams("date=2026-12-01");
    vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-12-01T13:00:00.000Z"));
    availability.mockResolvedValue(normal);
    createAppointment.mockResolvedValue(appointment());
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it("returning client books in six taps or fewer", async () => {
    mount();
    await pickClient();
    tap(await screen.findByRole("button", { name: "Same as last time" }));
    const first = await screen.findByRole("button", { name: /10:00 AM/ });
    tap(first);
    tap(await screen.findByRole("button", { name: /Save · 10:00 AM/ }));
    await waitFor(() => expect(createAppointment).toHaveBeenCalled());
    expect(taps).toBeLessThanOrEqual(6);
    expect(createAppointment).toHaveBeenCalledWith(
      expect.objectContaining({ customerId: CUSTOMER, segments: normal[0]!.segments, override: false }),
    );
    await waitFor(() => expect(push).toHaveBeenCalledWith(`/staff?date=2026-12-01&highlight=${id(100)}`));
  });

  it("shows the confirmation line when the API says the client is reachable (push only)", async () => {
    mount();
    await pickClient(client({ email: null, consents: { WHATSAPP: false, SMS: false, EMAIL: false, PUSH: true } }));
    expect(await screen.findByText("The client gets a confirmation")).toBeInTheDocument();
  });

  it("duplicate phone on a new client shows the phone-exists message", async () => {
    createCustomer.mockRejectedValue(
      new ApiError(409, { type: "about:blank", title: "x", status: 409, code: "CONFLICT" }),
    );
    mount();
    fireEvent.click(await screen.findByRole("button", { name: /New client/ }));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Ana Perez" } });
    fireEvent.change(screen.getByLabelText("Phone"), { target: { value: "7185550123" } });
    fireEvent.click(screen.getByRole("button", { name: "Add client" }));
    expect(await screen.findByText(/already exists/)).toBeInTheDocument();
  });

  it("an out-of-range ?date= falls back to today", async () => {
    searchParams = new URLSearchParams("date=2020-01-01");
    mount();
    await pickClient();
    tap(await screen.findByRole("button", { name: "Same as last time" }));
    await waitFor(() => expect(availability).toHaveBeenCalledWith(expect.objectContaining({ date: "2026-12-01" })));
  });

  it("shows the chosen professional in the times header", async () => {
    searchParams = new URLSearchParams(`date=2026-12-01&time=10:30&employeeId=${ANA}`);
    mount();
    await pickClient();
    tap(await screen.findByRole("button", { name: "Same as last time" }));
    expect(await screen.findByText(/NEXT TIMES · Ana|Next times · Ana/i)).toBeInTheDocument();
  });

  it("shows no messages when the API says the client is not reachable, even with email consent", async () => {
    mount();
    await pickClient(client({ reachable: false }));
    expect(await screen.findByText("No messages: no consented channel")).toBeInTheDocument();
  });

  it("new client sends consent only when ticked", async () => {
    createCustomer.mockResolvedValue(client());
    mount();
    searchCustomers.mockResolvedValue([]);
    fireEvent.click(await screen.findByRole("button", { name: /New client/ }));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Ana Perez" } });
    fireEvent.change(screen.getByLabelText("Phone"), { target: { value: "(718) 555-0123" } });
    fireEvent.click(screen.getByRole("button", { name: "Add client" }));
    await waitFor(() => expect(createCustomer).toHaveBeenCalledTimes(1));
    expect(createCustomer.mock.calls[0]![0]).toMatchObject({ name: "Ana Perez", locale: "en", consents: {} });
    expect(createCustomer.mock.calls[0]![0].consents).toEqual({});

    cleanup();
    createCustomer.mockClear();
    mount();
    fireEvent.click(await screen.findByRole("button", { name: /New client/ }));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Ana Perez" } });
    fireEvent.change(screen.getByLabelText("Phone"), { target: { value: "7185550123" } });
    fireEvent.change(screen.getByLabelText("Email (optional)"), { target: { value: "ana@example.com" } });
    fireEvent.click(screen.getByLabelText(/Agrees to email messages/));
    fireEvent.click(screen.getByRole("button", { name: "Add client" }));
    await waitFor(() => expect(createCustomer).toHaveBeenCalledTimes(1));
    expect(createCustomer.mock.calls[0]![0]).toMatchObject({
      email: "ana@example.com",
      consents: { EMAIL: true },
    });
  });

  it("pasted phone is normalized", async () => {
    createCustomer.mockResolvedValue(client());
    mount();
    fireEvent.click(await screen.findByRole("button", { name: /New client/ }));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Ana Perez" } });
    fireEvent.change(screen.getByLabelText("Phone"), { target: { value: "+1 (718) 555-0123" } });
    fireEvent.click(screen.getByRole("button", { name: "Add client" }));
    await waitFor(() => expect(createCustomer).toHaveBeenCalled());
    expect(createCustomer.mock.calls[0]![0]).toMatchObject({ phone: "+17185550123" });
  });

  it("out-of-hours slot requires Book anyway and sends override true", async () => {
    const early = slot("2026-12-01T22:00:00.000Z", ANA, { outsideHours: true }); // 17:00 local
    const night = slot("2026-12-02T08:00:00.000Z", ANA, { outsideHours: true }); // 03:00 local
    const ok = slot(T("15:00"), ANA, { outsideHours: false });
    availability.mockImplementation((q: { override?: boolean }) =>
      Promise.resolve(q.override ? [ok, early, night] : normal),
    );
    mount();
    await pickClient();
    tap(await screen.findByRole("button", { name: "Same as last time" }));
    tap(await screen.findByRole("button", { name: /Other time/ }));
    // the 03:00 local slot is outside the listed bounds
    await screen.findByRole("button", { name: /5:00 PM/ });
    expect(screen.queryByRole("button", { name: /3:00 AM/ })).toBeNull();
    expect(availability).toHaveBeenLastCalledWith(expect.objectContaining({ override: true }));
    tap(screen.getByRole("button", { name: /5:00 PM/ }));
    expect(screen.getByText(/Outside normal availability\. This time/)).toBeInTheDocument();
    const save = screen.getByRole("button", { name: /Save · 5:00 PM/ });
    expect(save).toBeDisabled();
    tap(screen.getByRole("button", { name: "Book anyway" }));
    tap(screen.getByRole("button", { name: /Save · 5:00 PM/ }));
    await waitFor(() => expect(createAppointment).toHaveBeenCalled());
    expect(createAppointment).toHaveBeenCalledWith(
      expect.objectContaining({ segments: early.segments, override: true }),
    );
  });

  it("prefill selects the gap slot", async () => {
    searchParams = new URLSearchParams(`date=2026-12-01&time=10:30&employeeId=${ANA}`);
    mount();
    await pickClient();
    tap(await screen.findByRole("button", { name: "Same as last time" }));
    const chosen = await screen.findByRole("button", { name: /10:30 AM/ });
    await waitFor(() => expect(chosen).toHaveAttribute("aria-pressed", "true"));
    expect(availability).toHaveBeenCalledWith(
      expect.objectContaining({ services: [{ serviceId: PEDI, employeeId: ANA }] }),
    );
  });

  it("SLOT_TAKEN refetches times", async () => {
    createAppointment.mockRejectedValueOnce(
      new ApiError(409, { type: "about:blank", title: "x", status: 409, code: "SLOT_TAKEN" }),
    );
    mount();
    await pickClient();
    tap(await screen.findByRole("button", { name: "Same as last time" }));
    tap(await screen.findByRole("button", { name: /10:00 AM/ }));
    const calls = availability.mock.calls.length;
    tap(await screen.findByRole("button", { name: /Save · 10:00 AM/ }));
    expect(await screen.findByText(/just taken/)).toBeInTheDocument();
    await waitFor(() => expect(availability.mock.calls.length).toBeGreaterThan(calls));
    expect(push).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /Save|Choose a time/ })).toBeDisabled();
  });

  it("preselects the client from customerId", async () => {
    searchParams = new URLSearchParams(`date=2026-12-01&customerId=${CUSTOMER}`);
    customer.mockResolvedValue(client());
    searchCustomers.mockResolvedValue([client()]);
    mount();
    expect(await screen.findByText("Maria Lopez")).toBeInTheDocument();
    expect(customer).toHaveBeenCalledWith(CUSTOMER);
    expect(await screen.findByRole("button", { name: "Same as last time" })).toBeInTheDocument();
  });
});
