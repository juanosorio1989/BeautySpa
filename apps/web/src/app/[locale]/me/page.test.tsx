import { ApiError } from "@beautyspa/api-client";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { en } from "@beautyspa/i18n";
import { appointment, emp, id, location, svc } from "@/components/booking/test-fixtures";
import { bookingStore } from "@/lib/booking/store";

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
  useParams: () => ({ locale: "en" }),
  useRouter: () => ({ push: vi.fn(), replace: routerReplace }),
}));
vi.mock("next-intl", async (orig) => ({ ...(await orig<typeof import("next-intl")>()), useLocale: () => "en" }));

const api = {
  auth: { refresh: vi.fn(), logout: vi.fn() },
  public: { locations: vi.fn(), services: vi.fn(), employees: vi.fn() },
  me: { appointments: vi.fn(), cancel: vi.fn(), repeat: vi.fn() },
};
vi.mock("@/lib/api/browser", () => ({ getBrowserApi: () => api, setSessionExpiredHandler: vi.fn() }));

import { SessionProvider } from "@/lib/session/session-provider";
import MePage from "./page";

const problem = (status: number, code: string) =>
  new ApiError(status, { type: "about:blank", title: "x", status, code } as never);

const mount = () =>
  render(
    <NextIntlClientProvider locale="en" messages={en}>
      <SessionProvider>
        <MePage />
      </SessionProvider>
    </NextIntlClientProvider>,
  );

const farFuture = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString();
const upcoming = (over = {}) => appointment({ startsAt: farFuture(10), endsAt: farFuture(10), ...over });

describe("/me", () => {
  beforeEach(() => {
    for (const group of Object.values(api)) for (const fn of Object.values(group)) fn.mockReset();
    push.mockReset();
    routerReplace.mockReset();
    bookingStore.reset();
    api.auth.refresh.mockResolvedValue({});
    api.public.locations.mockResolvedValue([{ ...location, phone: "+17185550100" }]);
    api.public.services.mockResolvedValue({ categories: [], services: [svc(1), svc(2)] });
    api.public.employees.mockResolvedValue([emp(11, [id(1)]), emp(12, [id(2)])]);
    api.me.appointments.mockResolvedValue({ upcoming: [upcoming()], past: [] });
  });

  it("signed-out visit redirects to /<locale>/login?next=/<locale>/me", async () => {
    api.auth.refresh.mockRejectedValue(problem(401, "UNAUTHORIZED"));
    mount();
    await waitFor(() => expect(routerReplace).toHaveBeenCalledWith(`/en/login?next=${encodeURIComponent("/en/me")}`));
  });

  it("a network failure on the session shows the network copy with retry", async () => {
    api.auth.refresh.mockRejectedValueOnce(new TypeError("fetch failed"));
    mount();
    expect(await screen.findByRole("alert")).toHaveTextContent("We could not reach the server");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("button", { name: "Cancel" })).toBeInTheDocument();
  });

  it("upcoming cards show Cancel and Change time only when canChangeOnline", async () => {
    api.me.appointments.mockResolvedValue({
      upcoming: [
        upcoming({ id: id(410) }),
        appointment({ id: id(411), startsAt: farFuture(0.1), endsAt: farFuture(0.2) }),
      ],
      past: [],
    });
    mount();
    await screen.findAllByRole("article");
    const [open, closed] = screen.getAllByRole("article");
    expect(within(open!).getByRole("button", { name: "Cancel" })).toBeInTheDocument();
    expect(within(open!).getByRole("link", { name: "Change time" })).toHaveAttribute(
      "href",
      `/me/appointments/${id(410)}/reschedule`,
    );
    expect(within(closed!).queryByRole("button", { name: "Cancel" })).not.toBeInTheDocument();
    expect(within(closed!).queryByRole("link", { name: "Change time" })).not.toBeInTheDocument();
    expect(within(closed!).getByRole("link", { name: /Call/ })).toHaveAttribute("href", "tel:+17185550100");
  });

  it("OUTSIDE_CANCEL_WINDOW shows the call-the-salon message with a tel: link", async () => {
    api.me.cancel.mockRejectedValue(problem(409, "OUTSIDE_CANCEL_WINDOW"));
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel appointment" }));
    expect(await within(dialog).findByText(/too late to change this online/)).toBeInTheDocument();
    expect(within(dialog).getByRole("link", { name: /Call/ })).toHaveAttribute("href", "tel:+17185550100");
  });

  it("cancel sends the optional reason and moves the card to past", async () => {
    const original = upcoming();
    api.me.appointments.mockResolvedValue({ upcoming: [original], past: [] });
    api.me.cancel.mockResolvedValue({ ...original, status: "CANCELLED", cancelReason: "Sick" });
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Reason (optional)"), { target: { value: "Sick" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel appointment" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(api.me.cancel).toHaveBeenCalledWith(original.id, { reason: "Sick" });
    expect(screen.queryByRole("button", { name: "Cancel" })).not.toBeInTheDocument();
    const past = screen.getByRole("region", { name: "Past" });
    expect(within(past).getByText("Cancelled")).toBeInTheDocument();
    expect(within(past).getByRole("button", { name: "Book again" })).toBeInTheDocument();
  });

  it("cancel without a reason sends an empty body", async () => {
    const original = upcoming();
    api.me.appointments.mockResolvedValue({ upcoming: [original], past: [] });
    api.me.cancel.mockResolvedValue({ ...original, status: "CANCELLED" });
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel appointment" }));
    await waitFor(() => expect(api.me.cancel).toHaveBeenCalledWith(original.id, {}));
  });

  it("a validation error on cancel shows the generic copy, never the API message", async () => {
    api.me.cancel.mockRejectedValue(
      new ApiError(400, {
        type: "about:blank",
        title: "x",
        status: 400,
        code: "VALIDATION_FAILED",
        errors: [{ path: "reason", message: "RAW API TEXT" }],
      } as never),
    );
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel appointment" }));
    const alert = await within(screen.getByRole("dialog")).findByRole("alert");
    expect(alert).toHaveTextContent("Something went wrong. Please try again.");
    expect(screen.queryByText(/RAW API TEXT/)).not.toBeInTheDocument();
  });

  it("past items show a status badge and Book again", async () => {
    api.me.appointments.mockResolvedValue({
      upcoming: [],
      past: [appointment({ id: id(420), status: "COMPLETED" }), appointment({ id: id(421), status: "NO_SHOW" })],
    });
    mount();
    expect(await screen.findByText("Completed")).toBeInTheDocument();
    expect(screen.getByText("No show")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Book again" })).toHaveLength(2);
  });

  it("book again prefills the store and opens step 2", async () => {
    api.me.appointments.mockResolvedValue({ upcoming: [], past: [appointment({ status: "COMPLETED" })] });
    api.me.repeat.mockResolvedValue({
      locationId: id(200),
      services: [
        { serviceId: id(1), employeeId: id(11) },
        { serviceId: id(2), employeeId: "ANY" },
      ],
    });
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Book again" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/book/time"));
    expect(bookingStore.getState().serviceIds).toEqual([id(1), id(2)]);
    expect(bookingStore.getState().choices[0]).toEqual({ serviceId: id(1), employeeId: id(11) });
  });

  it("book again opens step 1 when services is empty", async () => {
    api.me.appointments.mockResolvedValue({ upcoming: [], past: [appointment({ status: "COMPLETED" })] });
    api.me.repeat.mockResolvedValue({ locationId: id(200), services: [] });
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Book again" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/"));
  });

  it("shows an empty state with a booking link", async () => {
    api.me.appointments.mockResolvedValue({ upcoming: [], past: [] });
    mount();
    expect(await screen.findByText("You have no appointments yet.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Book an appointment" })).toHaveAttribute("href", "/");
  });
});
