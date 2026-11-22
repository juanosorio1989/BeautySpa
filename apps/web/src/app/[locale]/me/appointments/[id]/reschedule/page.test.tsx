import { ApiError } from "@beautyspa/api-client";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { en } from "@beautyspa/i18n";
import { appointment, emp, id, location, seg, slot, svc } from "@/components/booking/test-fixtures";

const push = vi.fn();
vi.mock("@/i18n/navigation", () => ({
  useRouter: () => ({ push, replace: vi.fn() }),
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
const routerReplace = vi.fn();
vi.mock("next/navigation", () => ({
  useParams: () => ({ locale: "en", id: id(400) }),
  useRouter: () => ({ push: vi.fn(), replace: routerReplace }),
}));
vi.mock("next-intl", async (orig) => ({ ...(await orig<typeof import("next-intl")>()), useLocale: () => "en" }));

const api = {
  auth: { refresh: vi.fn(), logout: vi.fn() },
  public: { locations: vi.fn(), services: vi.fn(), employees: vi.fn() },
  booking: { availability: vi.fn() },
  me: { appointments: vi.fn(), reschedule: vi.fn() },
};
vi.mock("@/lib/api/browser", () => ({ getBrowserApi: () => api, setSessionExpiredHandler: vi.fn() }));

import { SessionProvider } from "@/lib/session/session-provider";
import ReschedulePage from "./page";

const problem = (status: number, code: string) =>
  new ApiError(status, { type: "about:blank", title: "x", status, code } as never);

const mount = () =>
  render(
    <NextIntlClientProvider locale="en" messages={en}>
      <SessionProvider>
        <ReschedulePage />
      </SessionProvider>
    </NextIntlClientProvider>,
  );

const start = new Date(Date.now() + 10 * 86_400_000);
const iso = (min: number) => new Date(start.getTime() + min * 60_000).toISOString();
const current = appointment({
  startsAt: iso(0),
  endsAt: iso(45),
  segments: [
    { ...seg(1, 11, iso(0), iso(30)), id: id(401) },
    { ...seg(2, 12, iso(0), iso(45)), id: id(402) },
  ],
});
const newSlot = slot(iso(120), iso(165), [seg(1, 11, iso(120), iso(150)), seg(2, 12, iso(120), iso(165))]);

describe("/me/appointments/:id/reschedule", () => {
  beforeEach(() => {
    for (const group of Object.values(api)) for (const fn of Object.values(group)) fn.mockReset();
    push.mockReset();
    routerReplace.mockReset();
    api.auth.refresh.mockResolvedValue({});
    api.public.locations.mockResolvedValue([{ ...location, phone: "+17185550100" }]);
    api.public.services.mockResolvedValue({ categories: [], services: [svc(1), svc(2)] });
    api.public.employees.mockResolvedValue([emp(11, [id(1)]), emp(12, [id(2)])]);
    api.me.appointments.mockResolvedValue({ upcoming: [current], past: [] });
    api.booking.availability.mockResolvedValue([newSlot]);
  });

  it("signed-out visit redirects to login with next", async () => {
    api.auth.refresh.mockRejectedValue(problem(401, "UNAUTHORIZED"));
    mount();
    await waitFor(() =>
      expect(routerReplace).toHaveBeenCalledWith(
        `/en/login?next=${encodeURIComponent(`/en/me/appointments/${id(400)}/reschedule`)}`,
      ),
    );
  });

  it("queries availability with excludeAppointmentId and the appointment's professionals, and confirms with me.reschedule", async () => {
    api.me.reschedule.mockResolvedValue(current);
    mount();
    const slotButton = await screen.findByRole("button", { name: /\d:\d\d/ }, { timeout: 5000 });
    expect(api.booking.availability).toHaveBeenCalledWith(
      expect.objectContaining({
        excludeAppointmentId: id(400),
        services: [
          { serviceId: id(1), employeeId: id(11) },
          { serviceId: id(2), employeeId: id(12) },
        ],
      }),
    );
    fireEvent.click(slotButton);
    fireEvent.click(screen.getByRole("button", { name: "Confirm new time" }));
    await waitFor(() => expect(api.me.reschedule).toHaveBeenCalledWith(id(400), { segments: newSlot.segments }));
    expect(push).toHaveBeenCalledWith("/me");
  });

  it("SLOT_TAKEN refetches and keeps the old time", async () => {
    api.me.reschedule.mockRejectedValue(problem(409, "SLOT_TAKEN"));
    mount();
    fireEvent.click(await screen.findByRole("button", { name: /\d:\d\d/ }, { timeout: 5000 }));
    const calls = api.booking.availability.mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: "Confirm new time" }));
    expect(await screen.findByText("Someone just took that time. Pick another one.")).toBeInTheDocument();
    await waitFor(() => expect(api.booking.availability.mock.calls.length).toBeGreaterThan(calls));
    expect(push).not.toHaveBeenCalled();
  });

  it("OUTSIDE_CANCEL_WINDOW shows the call-the-salon message with a tel: link", async () => {
    api.me.reschedule.mockRejectedValue(problem(409, "OUTSIDE_CANCEL_WINDOW"));
    mount();
    fireEvent.click(await screen.findByRole("button", { name: /\d:\d\d/ }, { timeout: 5000 }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm new time" }));
    expect(await screen.findByText(/too late to change this online/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Call/ })).toHaveAttribute("href", "tel:+17185550100");
  });

  it("choosing another date queries that date", async () => {
    mount();
    await screen.findByRole("button", { name: /\d:\d\d/ }, { timeout: 5000 });
    const dates = api.booking.availability.mock.calls.map((c) => (c[0] as { date: string }).date);
    const first = dates[0]!;
    fireEvent.click(within(screen.getByRole("group", { name: "Date" })).getAllByRole("button", { pressed: false })[0]!);
    await waitFor(() =>
      expect(api.booking.availability.mock.calls.some((c) => (c[0] as { date: string }).date !== first)).toBe(true),
    );
  });

  it("a session error shows the network copy and retry loads the page", async () => {
    api.auth.refresh.mockRejectedValueOnce(new TypeError("offline"));
    mount();
    expect(await screen.findByRole("alert")).toHaveTextContent("We could not reach the server");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("button", { name: /\d:\d\d/ }, { timeout: 5000 })).toBeInTheDocument();
  });

  it("a validation error on confirm shows the generic copy", async () => {
    api.me.reschedule.mockRejectedValue(problem(400, "VALIDATION_FAILED"));
    mount();
    fireEvent.click(await screen.findByRole("button", { name: /\d:\d\d/ }, { timeout: 5000 }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm new time" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Something went wrong. Please try again.");
  });

  it("shows not found when the appointment is not upcoming for this customer", async () => {
    api.me.appointments.mockResolvedValue({ upcoming: [], past: [] });
    mount();
    expect(await screen.findByText("We could not find an upcoming appointment to change.")).toBeInTheDocument();
  });
});
