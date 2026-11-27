import { ApiError } from "@beautyspa/api-client";
import type { StaffMe } from "@beautyspa/contracts";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { en } from "@beautyspa/i18n";
import { StaffContext } from "@/lib/staff/use-staff";
import { CUSTOMER, MANI, appointment, catalog, client, id } from "../booking/test-fixtures";

vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const searchCustomers = vi.fn();
const customer = vi.fn();
const customerAppointments = vi.fn();
const notes = vi.fn();
const saveNotes = vi.fn();
const bookingCatalog = vi.fn();
vi.mock("@/lib/api/browser", () => ({
  getBrowserApi: () => ({
    public: {
      locations: () =>
        Promise.resolve([{ id: id(50), timezone: "America/New_York", booking: { bookingHorizonDays: 30 } }]),
    },
    staff: {
      searchCustomers,
      customer,
      customerAppointments,
      notes,
      saveNotes,
      bookingCatalog,
    },
  }),
}));

import { ClientDetail } from "./client-detail";
import { ClientSearch } from "./client-search";
import { RoleGuard } from "../role-guard";

function mount(ui: React.ReactNode, role: StaffMe["role"] = "RECEPTION") {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <StaffContext.Provider value={{ id: "1", name: "Ana", email: "a@x.dev", role }}>
        <RoleGuard allow={["OWNER", "RECEPTION"]}>{ui}</RoleGuard>
      </StaffContext.Provider>
    </NextIntlClientProvider>,
  );
}

const profile = {
  id: CUSTOMER,
  name: "Maria Lopez",
  phoneE164: "+17185550123",
  email: "maria@example.com",
  locale: "es" as const,
  consents: { WHATSAPP: false, SMS: false, EMAIL: true, PUSH: false },
};

function seed() {
  customer.mockResolvedValue(profile);
  customerAppointments.mockResolvedValue({
    upcoming: [appointment({ id: id(101) })],
    past: [
      appointment({
        id: id(102),
        status: "CANCELLED",
        cancelReason: "Client is sick",
        segments: [{ ...appointment().segments[0]!, serviceId: id(999) }],
      }),
      appointment({ id: id(103), status: "COMPLETED", segments: [{ ...appointment().segments[0]!, serviceId: MANI }] }),
    ],
  });
  notes.mockResolvedValue({
    notes: "Likes quiet",
    updatedAt: "2026-11-20T15:00:00.000Z",
    updatedBy: { id: id(8), name: "Bea" },
  });
}

describe("staff clients", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    bookingCatalog.mockResolvedValue(catalog);
    seed();
  });
  afterEach(cleanup);

  it("search shows results after two chars", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    searchCustomers.mockResolvedValue([client()]);
    mount(<ClientSearch />);
    const input = screen.getByLabelText("Search by name or phone");
    fireEvent.change(input, { target: { value: "m" } });
    await act(() => vi.advanceTimersByTimeAsync(400));
    expect(searchCustomers).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: "ma" } });
    await act(() => vi.advanceTimersByTimeAsync(400));
    const link = await screen.findByRole("link", { name: /Maria Lopez/ });
    expect(link).toHaveAttribute("href", `/staff/clients/${CUSTOMER}`);
    expect(screen.getByRole("link", { name: "New client" })).toHaveAttribute("href", "/staff/book");
    vi.useRealTimers();
  });

  it("detail renders past with cancel reasons", async () => {
    mount(<ClientDetail customerId={CUSTOMER} />);
    expect(await screen.findByText("Maria Lopez")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /\(718\) 555-0123/ })).toHaveAttribute("href", "tel:+17185550123");
    expect(screen.getByText("maria@example.com")).toBeInTheDocument();
    expect(screen.getByText("Spanish")).toBeInTheDocument();
    expect(await screen.findByText("Reason: Client is sick")).toBeInTheDocument();
    expect(screen.getByText(/^Manicure/)).toBeInTheDocument();
    expect(screen.getByText(/^Service ·/)).toBeInTheDocument(); // inactive/unknown service fallback
    const upcoming = screen.getByRole("heading", { name: "Upcoming" }).parentElement!;
    const past = screen.getByRole("heading", { name: "Past" }).parentElement!;
    expect(within(upcoming).getByText("Booked")).toBeInTheDocument();
    expect(within(upcoming).queryByText("Cancelled")).toBeNull();
    expect(within(past).getByText("Cancelled")).toBeInTheDocument();
    expect(within(past).getByText("Done")).toBeInTheDocument();
    expect(within(past).getAllByText(/2026/)).toHaveLength(2);
    expect(screen.getByRole("link", { name: "Book" })).toHaveAttribute("href", `/staff/book?customerId=${CUSTOMER}`);
  });

  it("detail shows not found for an unknown client", async () => {
    customer.mockRejectedValue(new ApiError(404, { type: "x", title: "x", status: 404, code: "NOT_FOUND" }));
    mount(<ClientDetail customerId={CUSTOMER} />);
    expect(await screen.findByText("This client was not found.")).toBeInTheDocument();
  });

  it("a failing catalog shows an alert with retry and no appointment times", async () => {
    bookingCatalog.mockRejectedValue(new ApiError(500, { type: "x", title: "x", status: 500, code: "INTERNAL" }));
    mount(<ClientDetail customerId={CUSTOMER} />);
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.queryByText(/AM|PM/)).toBeNull();
    expect(screen.queryByLabelText("Notes about this client")).toBeNull();
    bookingCatalog.mockResolvedValue(catalog);
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Reason: Client is sick")).toBeInTheDocument();
  });

  it("notes save shows updated by", async () => {
    saveNotes.mockResolvedValue({
      notes: "New text",
      updatedAt: "2026-11-27T15:00:00.000Z",
      updatedBy: { id: id(1), name: "Ana" },
    });
    mount(<ClientDetail customerId={CUSTOMER} />);
    const box = await screen.findByLabelText("Notes about this client");
    await waitFor(() => expect(box).toHaveValue("Likes quiet"));
    expect(screen.getByText(/Updated Nov 20, 2026 by Bea/)).toBeInTheDocument();
    fireEvent.change(box, { target: { value: "New text" } });
    expect(screen.getByText("8 / 2000")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Save notes" }));
    expect(await screen.findByText(/Updated Nov 27, 2026 by Ana/)).toBeInTheDocument();
    expect(saveNotes).toHaveBeenCalledWith(CUSTOMER, { notes: "New text" });
  });

  it("notes save failure keeps the text", async () => {
    saveNotes.mockRejectedValue(new ApiError(500, { type: "x", title: "x", status: 500, code: "INTERNAL" }));
    mount(<ClientDetail customerId={CUSTOMER} />);
    const box = await screen.findByLabelText("Notes about this client");
    await waitFor(() => expect(box).toHaveValue("Likes quiet"));
    fireEvent.change(box, { target: { value: "Draft I must not lose" } });
    fireEvent.click(screen.getByRole("button", { name: "Save notes" }));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(box).toHaveValue("Draft I must not lose");
  });

  it("EMPLOYEE gets not available", () => {
    mount(<ClientDetail customerId={CUSTOMER} />, "EMPLOYEE");
    expect(screen.getByText("Not available for your role")).toBeInTheDocument();
    expect(customer).not.toHaveBeenCalled();
  });
});
