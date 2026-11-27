import { ApiError } from "@beautyspa/api-client";
import type { Agenda, StaffAppointment, StaffMe } from "@beautyspa/contracts";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { en } from "@beautyspa/i18n";
import { StaffContext } from "@/lib/staff/use-staff";

// A device far from the salon: card times must still read in the agenda timezone.
process.env.TZ = "America/Los_Angeles";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ANA = id(1);
const BEA = id(2);
const SVC = id(10);

let searchParams = new URLSearchParams("date=2026-12-01");
const replace = vi.fn();
vi.mock("next/navigation", () => ({ useSearchParams: () => searchParams }));
vi.mock("@/i18n/navigation", () => ({
  useRouter: () => ({ replace, push: vi.fn() }),
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const agendaFn = vi.fn();
const setStatus = vi.fn();
const availability = vi.fn();
const moveAppointment = vi.fn();
const bookingCatalog = vi.fn();
vi.mock("@/lib/api/browser", () => ({
  getBrowserApi: () => ({
    public: { locations: () => Promise.resolve([{ timezone: "America/New_York" }]) },
    staff: { agenda: agendaFn, setStatus, availability, moveAppointment, bookingCatalog },
  }),
}));

import { AgendaView } from "./agenda-view";

const appt = (over: Partial<StaffAppointment> = {}): StaffAppointment => ({
  id: id(100),
  locationId: id(50),
  status: "BOOKED",
  source: "RECEPTION",
  startsAt: "2026-12-01T15:00:00.000Z", // 10:00 in New York, 07:00 in Los Angeles
  endsAt: "2026-12-01T15:45:00.000Z",
  totalPriceCents: 4000,
  notes: null,
  segments: [
    {
      id: id(200),
      serviceId: SVC,
      employeeId: ANA,
      resourceId: id(30),
      startsAt: "2026-12-01T15:00:00.000Z",
      endsAt: "2026-12-01T15:45:00.000Z",
      blockEndsAt: "2026-12-01T15:45:00.000Z",
      durationMin: 45,
      priceCents: 4000,
    },
  ],
  confirmedByCustomerAt: null,
  cancelledAt: null,
  cancelReason: null,
  createdAt: "2026-11-20T12:00:00.000Z",
  customer: { id: id(300), name: "Lucia R.", phoneE164: "+13055550101", reachable: true },
  createdByStaffId: null,
  cancelledBy: null,
  ...over,
});

const range = { start: "2026-12-01T14:00:00.000Z", end: "2026-12-01T22:00:00.000Z" }; // 9:00-17:00 local
const agenda = (appointments: StaffAppointment[] = [appt()], employees = [ANA, BEA]): Agenda => ({
  date: "2026-12-01",
  locationId: id(50),
  timezone: "America/New_York",
  appointments,
  employees: employees.map((e) => ({ id: e, displayName: e === ANA ? "Ana" : "Bea", active: true, ranges: [range] })),
  services: [{ id: SVC, name: { en: "Pedicure", es: "Pedicura" } }],
  resources: [{ id: id(30), name: "Chair 2" }],
});

function setWide(wide: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: wide,
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  })) as unknown as typeof window.matchMedia;
}

function mount(role: StaffMe["role"] = "RECEPTION", meId = id(900)) {
  render(
    <NextIntlClientProvider locale="en" messages={en}>
      <StaffContext.Provider value={{ id: meId, name: "Sam", email: "s@x.dev", role }}>
        <AgendaView />
      </StaffContext.Provider>
    </NextIntlClientProvider>,
  );
}

const conflict = () => new ApiError(409, { type: "about:blank", title: "x", status: 409, code: "CONFLICT" });

describe("AgendaView", () => {
  beforeEach(() => {
    searchParams = new URLSearchParams("date=2026-12-01");
    vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-12-01T16:00:00.000Z")); // 11:00 in New York
    setWide(true);
    agendaFn.mockResolvedValue(agenda());
    window.localStorage.clear();
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it("agenda card times use the agenda timezone", async () => {
    mount();
    expect(await screen.findByText(/10:00 AM – 10:45 AM/)).toBeInTheDocument();
    expect(screen.queryByText(/7:00 AM/)).toBeNull();
  });

  it("cards without a customer or name use fallbacks", async () => {
    const second = appt();
    agendaFn.mockResolvedValue(
      agenda([
        appt({ id: id(101), customer: null }),
        appt({
          id: id(102),
          startsAt: "2026-12-01T17:00:00.000Z",
          endsAt: "2026-12-01T17:45:00.000Z",
          segments: [
            {
              ...second.segments[0]!,
              id: id(201),
              startsAt: "2026-12-01T17:00:00.000Z",
              endsAt: "2026-12-01T17:45:00.000Z",
            },
          ],
          customer: { id: id(301), name: null, phoneE164: "+13055550102", reachable: false },
        }),
      ]),
    );
    mount();
    expect(await screen.findByText("Walk-in client")).toBeInTheDocument();
    expect(screen.getByText("Client")).toBeInTheDocument();
    expect(screen.getByText("No messages")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Walk-in client"));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).queryByRole("link", { name: /open client/i })).toBeNull();
    expect(within(dialog).queryByRole("link", { name: /\+1305/ })).toBeNull();
  });

  it("a 409 on an action shows changed and refetches", async () => {
    setStatus.mockRejectedValue(conflict());
    mount();
    fireEvent.click(await screen.findByText("Lucia R."));
    const dialog = await screen.findByRole("dialog");
    const before = agendaFn.mock.calls.length;
    fireEvent.click(within(dialog).getByRole("button", { name: "Check in" }));
    expect(await within(dialog).findByText("This appointment changed, refreshed.")).toBeInTheDocument();
    expect(setStatus).toHaveBeenCalledWith(id(100), { status: "CHECKED_IN" });
    await waitFor(() => expect(agendaFn.mock.calls.length).toBeGreaterThan(before));
  });

  it("phone width shows one column, wide shows all", async () => {
    setWide(false);
    mount();
    await screen.findByText("Lucia R.");
    expect(screen.getAllByRole("region")).toHaveLength(1);
    cleanup();
    setWide(true);
    mount();
    await screen.findByText("Lucia R.");
    expect(screen.getAllByRole("region")).toHaveLength(2);
  });

  it("Show cancelled refetches with includeCancelled", async () => {
    mount();
    await screen.findByText("Lucia R.");
    expect(agendaFn).toHaveBeenLastCalledWith({ date: "2026-12-01", includeCancelled: false });
    fireEvent.click(screen.getByRole("checkbox", { name: "Show cancelled" }));
    await waitFor(() => expect(agendaFn).toHaveBeenLastCalledWith({ date: "2026-12-01", includeCancelled: true }));
  });

  it("gap tap links to quick booking with prefill", async () => {
    mount("OWNER");
    await screen.findByText("Lucia R.");
    const gap = screen.getAllByRole("link", { name: /Free · 9:00 AM – 10:00 AM/ })[0]!;
    expect(gap).toHaveAttribute("href", `/staff/book?date=2026-12-01&time=09:00&employeeId=${ANA}`);
  });

  it("EMPLOYEE sees no New, Walk-in or gap links", async () => {
    agendaFn.mockResolvedValue(agenda([appt()], [ANA]));
    mount("EMPLOYEE", ANA);
    await screen.findByText("Lucia R.");
    expect(screen.queryByRole("link", { name: "+ New" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Walk-in" })).toBeNull();
    expect(screen.queryByRole("link", { name: /^Free/ })).toBeNull();
  });

  it("RECEPTION sees New and Walk-in", async () => {
    mount("RECEPTION");
    await screen.findByText("Lucia R.");
    expect(screen.getByRole("link", { name: "+ New" })).toHaveAttribute("href", "/staff/book?date=2026-12-01");
    expect(screen.getByRole("link", { name: "Walk-in" })).toHaveAttribute("href", "/staff/walk-in");
  });

  it("shows part i of n on each segment of a multi-employee appointment", async () => {
    const base = appt();
    const second = {
      ...base.segments[0]!,
      id: id(202),
      employeeId: BEA,
      startsAt: "2026-12-01T15:45:00.000Z",
      endsAt: "2026-12-01T16:15:00.000Z",
    };
    agendaFn.mockResolvedValue(agenda([appt({ segments: [base.segments[0]!, second], endsAt: second.endsAt })]));
    mount();
    expect(await screen.findByText("Part 1 of 2")).toBeInTheDocument();
    expect(screen.getByText("Part 2 of 2")).toBeInTheDocument();
  });

  it("no-show is disabled with its start time before the appointment starts", async () => {
    agendaFn.mockResolvedValue(
      agenda([appt({ startsAt: "2026-12-01T18:00:00.000Z", endsAt: "2026-12-01T18:45:00.000Z" })]),
    );
    mount();
    fireEvent.click(await screen.findByText("Lucia R."));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("button", { name: "No-show (available from 1:00 PM)" })).toBeDisabled();
  });

  it("cancel asks for a reason and sends it", async () => {
    setStatus.mockResolvedValue(appt());
    mount();
    fireEvent.click(await screen.findByText("Lucia R."));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel appointment" }));
    fireEvent.change(within(dialog).getByLabelText("Reason (optional)"), { target: { value: " sick " } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel this appointment" }));
    await waitFor(() => expect(setStatus).toHaveBeenCalledWith(id(100), { status: "CANCELLED", reason: "sick" }));
  });

  it("EMPLOYEE confirms before marking an appointment shared with another professional", async () => {
    const base = appt();
    const other = { ...base.segments[0]!, id: id(203), employeeId: BEA };
    agendaFn.mockResolvedValue(agenda([appt({ segments: [base.segments[0]!, other] })]));
    setStatus.mockResolvedValue(appt());
    mount("EMPLOYEE", ANA);
    fireEvent.click((await screen.findAllByText("Lucia R."))[0]!);
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Check in" }));
    expect(setStatus).not.toHaveBeenCalled();
    expect(within(dialog).getByText(/marks the whole appointment/)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Confirm" }));
    await waitFor(() => expect(setStatus).toHaveBeenCalledWith(id(100), { status: "CHECKED_IN" }));
  });

  it("move sheet loads slots for the same services and saves the picked one", async () => {
    const slot = {
      startsAt: "2026-12-01T19:00:00.000Z",
      endsAt: "2026-12-01T19:45:00.000Z",
      segments: [appt().segments[0]!],
    };
    availability.mockResolvedValue([slot]);
    bookingCatalog.mockResolvedValue({ categories: [], services: [], employees: [], popularServiceIds: [] });
    moveAppointment.mockResolvedValue(appt());
    mount();
    fireEvent.click(await screen.findByText("Lucia R."));
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Move" }));
    fireEvent.click(await screen.findByRole("button", { name: "2:00 PM" }));
    expect(availability).toHaveBeenCalledWith(
      expect.objectContaining({
        services: [{ serviceId: SVC, employeeId: ANA }],
        date: "2026-12-01",
        excludeAppointmentId: id(100),
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Save · 2:00 PM" }));
    await waitFor(() => expect(moveAppointment).toHaveBeenCalledWith(id(100), { segments: slot.segments }));
  });

  it("move sheet refetches the times on SLOT_TAKEN", async () => {
    const slot = {
      startsAt: "2026-12-01T19:00:00.000Z",
      endsAt: "2026-12-01T19:45:00.000Z",
      segments: [appt().segments[0]!],
    };
    availability.mockResolvedValue([slot]);
    bookingCatalog.mockResolvedValue({ categories: [], services: [], employees: [], popularServiceIds: [] });
    moveAppointment.mockRejectedValue(
      new ApiError(409, { type: "about:blank", title: "x", status: 409, code: "SLOT_TAKEN" }),
    );
    mount();
    fireEvent.click(await screen.findByText("Lucia R."));
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Move" }));
    fireEvent.click(await screen.findByRole("button", { name: "2:00 PM" }));
    fireEvent.click(screen.getByRole("button", { name: "Save · 2:00 PM" }));
    expect(await screen.findByText("Someone just took that time. Pick another one.")).toBeInTheDocument();
    await waitFor(() => expect(availability).toHaveBeenCalledTimes(2));
  });

  it("highlight scrolls to the card and outlines it", async () => {
    searchParams = new URLSearchParams(`date=2026-12-01&highlight=${id(100)}`);
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    mount();
    const card = (await screen.findByText("Lucia R.")).closest("button")!;
    await waitFor(() => expect(scroll).toHaveBeenCalled());
    expect(card.className).toContain("outline-plum");
  });
});
