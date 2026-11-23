import { ApiError } from "@beautyspa/api-client";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { en } from "@beautyspa/i18n";
import type { ManageView as ManageViewData } from "@beautyspa/contracts";
import { appointment } from "@/components/booking/test-fixtures";

vi.mock("next-intl", async (orig) => ({ ...(await orig<typeof import("next-intl")>()), useLocale: () => "en" }));

const manage = { get: vi.fn(), confirm: vi.fn(), cancel: vi.fn(), calendarUrl: vi.fn() };
vi.mock("@/lib/api/browser", () => ({ getBrowserApi: () => ({ manage }) }));

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
    for (const fn of Object.values(manage)) fn.mockReset();
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
    fireEvent.click(screen.getAllByRole("button", { name: "Cancel appointment" }).at(-1)!);
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
});
