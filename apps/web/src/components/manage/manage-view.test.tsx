import { ApiError } from "@beautyspa/api-client";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { en } from "@beautyspa/i18n";
import type { ManageView as ManageViewData } from "@beautyspa/contracts";
import { appointment, emp, id, svc } from "@/components/booking/test-fixtures";

vi.mock("next-intl", async (orig) => ({ ...(await orig<typeof import("next-intl")>()), useLocale: () => "en" }));

const manage = { get: vi.fn(), confirm: vi.fn(), cancel: vi.fn(), calendarUrl: vi.fn() };
const pub = { services: vi.fn(), employees: vi.fn() };
vi.mock("@/lib/api/browser", () => ({ getBrowserApi: () => ({ manage, public: pub }) }));

import { ManageView } from "./manage-view";

const view = (over: Partial<ManageViewData> = {}): ManageViewData => ({
  appointment: appointment(),
  location: { name: "Demo Salon", addressLine: "1 Main St", phone: "+17185550100", timezone: "America/New_York" },
  canCancel: true,
  canConfirm: true,
  ...over,
});

const mount = () =>
  render(
    <NextIntlClientProvider locale="en" messages={en}>
      <ManageView token="tok" />
    </NextIntlClientProvider>,
  );

describe("ManageView", () => {
  beforeEach(() => {
    for (const fn of [...Object.values(manage), ...Object.values(pub)]) fn.mockReset();
    pub.services.mockResolvedValue({ categories: [], services: [svc(1), svc(2)] });
    pub.employees.mockResolvedValue([emp(11, [id(1)]), emp(12, [id(2)])]);
    manage.calendarUrl.mockReturnValue("http://api/v1/manage/tok/calendar.ics");
  });

  it("shows confirm when canConfirm and confirmed after click", async () => {
    manage.get.mockResolvedValue(view());
    manage.confirm.mockResolvedValue(
      view({
        canConfirm: false,
        appointment: appointment({ confirmedByCustomerAt: "2026-11-19T10:00:00.000Z" }),
      }),
    );
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Confirm I'll be there" }));
    expect(await screen.findByText("Confirmed")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Confirm I'll be there" })).toBeNull();
    expect(manage.confirm).toHaveBeenCalledWith("tok");
  });

  it("shows cancel sheet when canCancel and shows the cancelled state", async () => {
    manage.get.mockResolvedValue(view());
    manage.cancel.mockResolvedValue(
      view({ canCancel: false, canConfirm: false, appointment: appointment({ status: "CANCELLED" }) }),
    );
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Cancel appointment" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel appointment" }));
    expect(await screen.findByText("Cancelled")).toBeInTheDocument();
    expect(manage.cancel).toHaveBeenCalledWith("tok", {});
    expect(screen.getByRole("link", { name: "Book again" })).toHaveAttribute("href", "/en/services");
  });

  it("shows call salon when not cancellable", async () => {
    manage.get.mockResolvedValue(view({ canCancel: false }));
    mount();
    expect(await screen.findByRole("link", { name: /Call/ })).toHaveAttribute("href", "tel:+17185550100");
    expect(screen.queryByRole("button", { name: "Cancel appointment" })).toBeNull();
  });

  it("invalid link message on 404", async () => {
    manage.get.mockRejectedValue(
      new ApiError(404, { type: "about:blank", title: "x", status: 404, code: "NOT_FOUND" } as never),
    );
    mount();
    expect(await screen.findByText("This link is no longer valid")).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByRole("link")).toHaveAttribute("href", "/en/me");
  });

  it("add to calendar link points at calendarUrl", async () => {
    manage.get.mockResolvedValue(view());
    mount();
    await waitFor(() =>
      expect(screen.getByRole("link", { name: "Add to calendar" })).toHaveAttribute(
        "href",
        "http://api/v1/manage/tok/calendar.ics",
      ),
    );
    expect(screen.getByRole("link", { name: "Reschedule" })).toHaveAttribute("href", "/en/login?next=%2Fen%2Fme");
  });

  it("renders segment service and employee names", async () => {
    manage.get.mockResolvedValue(view());
    mount();
    expect(await screen.findByText(/Svc 1/)).toHaveTextContent("Emp 11");
    expect(screen.getByText(/Svc 2/)).toHaveTextContent("Emp 12");
  });

  it("falls back to your professional when the catalog fails", async () => {
    manage.get.mockResolvedValue(view());
    pub.services.mockRejectedValue(new TypeError("net"));
    pub.employees.mockRejectedValue(new TypeError("net"));
    mount();
    expect(await screen.findAllByText(/Your professional/)).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Confirm I'll be there" })).toBeInTheDocument();
  });

  it("non-404 load error shows an alert and a link to my appointments", async () => {
    manage.get.mockRejectedValue(new TypeError("net"));
    mount();
    expect(await screen.findByRole("alert")).toHaveTextContent(en.errors.network);
    expect(screen.getByRole("link", { name: "Go to my appointments" })).toHaveAttribute("href", "/en/me");
  });

  it("failed confirm shows the error, re-fetches and re-enables the button", async () => {
    manage.get.mockResolvedValue(view());
    manage.confirm.mockRejectedValue(new TypeError("net"));
    mount();
    const btn = await screen.findByRole("button", { name: "Confirm I'll be there" });
    fireEvent.click(btn);
    expect(await screen.findByRole("alert")).toHaveTextContent(en.errors.network);
    await waitFor(() => expect(manage.get).toHaveBeenCalledTimes(2));
    expect(screen.getByRole("button", { name: "Confirm I'll be there" })).toBeEnabled();
  });

  it("too-late cancel shows call salon and re-fetches the view on close", async () => {
    manage.get.mockResolvedValueOnce(view());
    manage.cancel.mockRejectedValue(
      new ApiError(409, { type: "about:blank", title: "x", status: 409, code: "OUTSIDE_CANCEL_WINDOW" } as never),
    );
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Cancel appointment" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel appointment" }));
    expect(await within(dialog).findByRole("link", { name: /Call/ })).toBeInTheDocument();
    manage.get.mockResolvedValue(view({ canCancel: false }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));
    await waitFor(() => expect(manage.get).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Cancel appointment" })).toBeNull());
  });

  it("loading text is a status", () => {
    manage.get.mockReturnValue(new Promise(() => {}));
    mount();
    expect(screen.getByRole("status")).toHaveTextContent("Loading your appointment");
  });
});
