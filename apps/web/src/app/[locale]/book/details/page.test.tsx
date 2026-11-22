import { ApiError } from "@beautyspa/api-client";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { en } from "@beautyspa/i18n";
import { id, me } from "@/components/booking/test-fixtures";
import { bookingStore } from "@/lib/booking/store";

const replace = vi.fn();
vi.mock("@/i18n/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace }),
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const api = {
  auth: { refresh: vi.fn(), logout: vi.fn(), otpStart: vi.fn(), otpVerify: vi.fn() },
  me: { get: vi.fn(), patch: vi.fn() },
  booking: { book: vi.fn() },
};
vi.mock("@/lib/api/browser", () => ({
  getBrowserApi: () => api,
  setSessionExpiredHandler: vi.fn(),
}));

import { SessionProvider } from "@/lib/session/session-provider";
import DetailsPage from "./page";

const CODE_LABEL = /^We (texted you|sent you) a code/;
const apiError = (status: number, code: string, errors?: { path: string; message: string }[]) =>
  new ApiError(status, { type: "about:blank", title: "x", status, code, ...(errors ? { errors } : {}) } as never);

const validHold = () => ({
  holdId: id(500),
  expiresAt: new Date(Date.now() + 300_000).toISOString(),
  localExpiresAt: Date.now() + 300_000,
});

const mount = () =>
  render(
    <NextIntlClientProvider locale="en" messages={en}>
      <SessionProvider>
        <DetailsPage />
      </SessionProvider>
    </NextIntlClientProvider>,
  );

const signedIn = () => {
  api.auth.refresh.mockResolvedValue({});
};
const signedOut = () => {
  api.auth.refresh.mockRejectedValue(apiError(401, "UNAUTHORIZED"));
};

describe("/book/details", () => {
  beforeEach(() => {
    sessionStorage.clear();
    bookingStore.reset();
    bookingStore.toggleService(id(1));
    bookingStore.setHold(validHold());
    replace.mockReset();
    for (const group of Object.values(api)) for (const fn of Object.values(group)) fn.mockReset();
  });

  it("details with an expired stored hold returns to time with the expired message", async () => {
    bookingStore.setHold({ ...validHold(), localExpiresAt: Date.now() - 1_000 });
    signedOut();
    mount();
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/book/time?notice=expired"));
    expect(bookingStore.getState().hold).toBeNull();
  });

  it("a fast device clock does not expire a fresh hold: the countdown follows the local deadline", async () => {
    // The server's expiresAt is 5 minutes in the device's past; the local deadline is 5 minutes ahead.
    bookingStore.setHold({
      ...validHold(),
      expiresAt: new Date(Date.now() - 300_000).toISOString(),
      localExpiresAt: Date.now() + 300_000,
    });
    signedOut();
    mount();
    expect(await screen.findByText(/We're holding your time for (5:00|4:59)/)).toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();
    expect(bookingStore.getState().hold).not.toBeNull();
  });

  it("details without a hold returns to time", async () => {
    bookingStore.clearHold();
    signedOut();
    mount();
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/book/time"));
  });

  it("signed-out customer sees the countdown and the phone step", async () => {
    signedOut();
    mount();
    expect(await screen.findByLabelText("Your mobile number")).toBeInTheDocument();
    expect(screen.getByText(/We're holding your time for \d:\d\d/)).toBeInTheDocument();
  });

  it("a session error shows the message and retry calls ensure again", async () => {
    api.auth.refresh
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockRejectedValue(apiError(401, "UNAUTHORIZED"));
    mount();
    expect(await screen.findByRole("alert")).toHaveTextContent("We could not reach the server");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByLabelText("Your mobile number")).toBeInTheDocument();
    expect(api.auth.refresh).toHaveBeenCalledTimes(2);
  });

  it("after code verification the first-time form appears", async () => {
    signedOut();
    api.auth.otpStart.mockResolvedValue({ channel: "sms" });
    api.auth.otpVerify.mockResolvedValue({ isNew: true });
    api.me.get.mockResolvedValue(me());
    mount();
    fireEvent.change(await screen.findByLabelText("Your mobile number"), { target: { value: "7185550123" } });
    fireEvent.click(screen.getByRole("button", { name: "Send code" }));
    fireEvent.change(await screen.findByLabelText(CODE_LABEL), { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: "Verify code" }));
    expect(await screen.findByLabelText("Your name")).toBeInTheDocument();
  });

  describe("signed in", () => {
    beforeEach(signedIn);

    it("first-time customer must enter a name; email consent is disabled until an email is typed", async () => {
      api.me.get.mockResolvedValue(me());
      mount();
      const consent = await screen.findByLabelText("Email me my confirmation and reminders");
      expect(consent).toBeDisabled();
      expect(consent).not.toBeChecked();
      fireEvent.change(screen.getByLabelText("Email (optional)"), { target: { value: "m@x.co" } });
      expect(consent).toBeEnabled();
      fireEvent.change(screen.getByLabelText("Email (optional)"), { target: { value: "" } });
      expect(consent).toBeDisabled();
      fireEvent.click(screen.getByRole("button", { name: "Confirm appointment" }));
      expect(await screen.findByText("Please enter your name.")).toBeInTheDocument();
      expect(api.me.patch).not.toHaveBeenCalled();
      expect(api.booking.book).not.toHaveBeenCalled();
    });

    it("confirm sends PATCH /me with only changed keys and consentSource BOOKING_FORM only with consents, then POST /appointments", async () => {
      api.me.get.mockResolvedValue(me({ locale: "es" }));
      api.me.patch.mockResolvedValue(me({ name: "Maria", locale: "en" }));
      api.booking.book.mockResolvedValue({ id: id(400) });
      mount();
      fireEvent.change(await screen.findByLabelText("Your name"), { target: { value: " Maria " } });
      fireEvent.change(screen.getByLabelText("Email (optional)"), { target: { value: "m@x.co" } });
      fireEvent.click(screen.getByLabelText("Email me my confirmation and reminders"));
      fireEvent.change(screen.getByLabelText("Note for the salon (optional)"), { target: { value: "Hi" } });
      fireEvent.click(screen.getByRole("button", { name: "Confirm appointment" }));
      await waitFor(() => expect(replace).toHaveBeenCalledWith("/book/done/" + id(400)));
      expect(api.me.patch).toHaveBeenCalledWith({
        name: "Maria",
        locale: "en",
        email: "m@x.co",
        consents: { EMAIL: true },
        consentSource: "BOOKING_FORM",
      });
      expect(api.booking.book).toHaveBeenCalledWith({ holdId: id(500), notes: "Hi" });
      expect(api.me.patch.mock.invocationCallOrder[0]).toBeLessThan(api.booking.book.mock.invocationCallOrder[0]!);
      expect(bookingStore.getState().hold).toBeNull();
      expect(bookingStore.getState().serviceIds).toEqual([]);
      expect(sessionStorage.getItem("bs-booking")).toBeNull();
      expect(replace).not.toHaveBeenCalledWith(expect.stringContaining("/book/time"));
    });

    it("sends only the name when no email is typed (no consentSource, no locale if unchanged)", async () => {
      api.me.get.mockResolvedValue(me());
      api.me.patch.mockResolvedValue(me({ name: "Maria" }));
      api.booking.book.mockResolvedValue({ id: id(400) });
      mount();
      fireEvent.change(await screen.findByLabelText("Your name"), { target: { value: "Maria" } });
      fireEvent.click(screen.getByRole("button", { name: "Confirm appointment" }));
      await waitFor(() => expect(api.booking.book).toHaveBeenCalled());
      expect(api.me.patch).toHaveBeenCalledWith({ name: "Maria" });
      expect(api.booking.book).toHaveBeenCalledWith({ holdId: id(500) });
    });

    it('returning signed-in customer skips phone and code and sees "Booking as <name>"', async () => {
      api.me.get.mockResolvedValue(me({ name: "Ana" }));
      api.booking.book.mockResolvedValue({ id: id(400) });
      mount();
      expect(await screen.findByText("Booking as Ana")).toBeInTheDocument();
      expect(screen.queryByLabelText("Your mobile number")).not.toBeInTheDocument();
      expect(screen.queryByLabelText("Your name")).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Confirm appointment" }));
      await waitFor(() => expect(replace).toHaveBeenCalledWith("/book/done/" + id(400)));
      expect(api.me.patch).not.toHaveBeenCalled();
    });

    it("Not you? logs out and returns to the phone step", async () => {
      api.me.get.mockResolvedValue(me({ name: "Ana" }));
      // the real server clears the refresh cookie, so a later refresh answers 401
      api.auth.logout.mockImplementation(async () => {
        signedOut();
      });
      mount();
      await screen.findByText("Booking as Ana");
      fireEvent.click(screen.getByRole("button", { name: "Not you?" }));
      expect(await screen.findByLabelText("Your mobile number")).toBeInTheDocument();
      expect(api.auth.logout).toHaveBeenCalled();
      // the held time survives the account switch
      expect(bookingStore.getState().hold?.holdId).toBe(id(500));
      expect(bookingStore.getState().serviceIds).toEqual([id(1)]);
      expect(replace).not.toHaveBeenCalled();
    });

    it("HOLD_EXPIRED on confirm returns to time", async () => {
      api.me.get.mockResolvedValue(me({ name: "Ana" }));
      api.booking.book.mockRejectedValue(apiError(409, "HOLD_EXPIRED"));
      mount();
      fireEvent.click(await screen.findByRole("button", { name: "Confirm appointment" }));
      await waitFor(() => expect(replace).toHaveBeenCalledWith("/book/time?notice=expired"));
      expect(bookingStore.getState().hold).toBeNull();
    });

    it("NOT_FOUND on confirm (hold gone) is treated like HOLD_EXPIRED", async () => {
      api.me.get.mockResolvedValue(me({ name: "Ana" }));
      api.booking.book.mockRejectedValue(apiError(404, "NOT_FOUND"));
      mount();
      fireEvent.click(await screen.findByRole("button", { name: "Confirm appointment" }));
      await waitFor(() => expect(replace).toHaveBeenCalledWith("/book/time?notice=expired"));
      expect(bookingStore.getState().hold).toBeNull();
    });

    it("CONFLICT on confirm clears the hold and returns to time with the my-appointments notice", async () => {
      api.me.get.mockResolvedValue(me({ name: "Ana" }));
      api.booking.book.mockRejectedValue(apiError(409, "CONFLICT"));
      mount();
      fireEvent.click(await screen.findByRole("button", { name: "Confirm appointment" }));
      await waitFor(() => expect(replace).toHaveBeenCalledWith("/book/time?notice=conflict"));
      expect(bookingStore.getState().hold).toBeNull();
    });

    it("a name validation error shows localized copy, not the API message", async () => {
      api.me.get.mockResolvedValue(me());
      api.me.patch.mockRejectedValue(apiError(400, "VALIDATION_FAILED", [{ path: "name", message: "Too long" }]));
      mount();
      fireEvent.change(await screen.findByLabelText("Your name"), { target: { value: "Maria" } });
      fireEvent.click(screen.getByRole("button", { name: "Confirm appointment" }));
      expect(await screen.findByText("Please enter a valid name.")).toBeInTheDocument();
      expect(screen.queryByText("Too long")).not.toBeInTheDocument();
      expect(screen.getByLabelText("Your name")).toHaveAttribute("aria-invalid", "true");
      expect(screen.getByLabelText("Your name")).toHaveAccessibleDescription("Please enter a valid name.");
      expect(api.booking.book).not.toHaveBeenCalled();
      expect(bookingStore.getState().hold).not.toBeNull();
    });

    it("a validation error on a field that is not on screen shows the generic message", async () => {
      api.me.get.mockResolvedValue(me({ name: "Ana" }));
      api.booking.book.mockRejectedValue(apiError(400, "VALIDATION_FAILED", [{ path: "holdId", message: "bad uuid" }]));
      mount();
      fireEvent.click(await screen.findByRole("button", { name: "Confirm appointment" }));
      expect(await screen.findByRole("alert")).toHaveTextContent(en.errors.generic);
      expect(screen.queryByText("bad uuid")).not.toBeInTheDocument();
    });

    it("an email error for a returning customer (no email field) shows the generic message", async () => {
      api.me.get.mockResolvedValue(me({ name: "Ana" }));
      api.booking.book.mockRejectedValue(apiError(400, "VALIDATION_FAILED", [{ path: "email", message: "bad" }]));
      mount();
      fireEvent.click(await screen.findByRole("button", { name: "Confirm appointment" }));
      expect(await screen.findByRole("alert")).toHaveTextContent(en.errors.generic);
    });

    it("a PATCH /me conflict does not run the booking conflict handling and keeps the hold", async () => {
      api.me.get.mockResolvedValue(me());
      api.me.patch.mockRejectedValue(apiError(409, "CONFLICT"));
      mount();
      fireEvent.change(await screen.findByLabelText("Your name"), { target: { value: "Maria" } });
      fireEvent.click(screen.getByRole("button", { name: "Confirm appointment" }));
      expect(await screen.findByRole("alert")).toHaveTextContent("cannot be changed");
      expect(replace).not.toHaveBeenCalled();
      expect(bookingStore.getState().hold).not.toBeNull();
      expect(api.booking.book).not.toHaveBeenCalled();
    });

    it("Not you? with a failing logout keeps the hold, shows the network message and retries", async () => {
      api.me.get.mockResolvedValue(me({ name: "Ana" }));
      api.auth.logout.mockRejectedValueOnce(new TypeError("Failed to fetch")).mockImplementationOnce(async () => {
        signedOut();
      });
      mount();
      await screen.findByText("Booking as Ana");
      const refreshCalls = api.auth.refresh.mock.calls.length;
      fireEvent.click(screen.getByRole("button", { name: "Not you?" }));
      expect(await screen.findByRole("alert")).toHaveTextContent("We could not reach the server");
      expect(bookingStore.getState().hold?.holdId).toBe(id(500));
      expect(api.auth.refresh.mock.calls.length).toBe(refreshCalls);
      expect(replace).not.toHaveBeenCalled();

      fireEvent.click(screen.getByRole("button", { name: "Try again" }));
      expect(await screen.findByLabelText("Your mobile number")).toBeInTheDocument();
      expect(api.auth.logout).toHaveBeenCalledTimes(2);
      expect(bookingStore.getState().hold?.holdId).toBe(id(500));
      expect(replace).not.toHaveBeenCalled();
    });

    it("never shows the previous customer's name to the next one while their profile loads", async () => {
      api.me.get.mockResolvedValueOnce(me({ name: "Ana" }));
      api.auth.logout.mockImplementation(async () => {
        signedOut();
      });
      api.auth.otpStart.mockResolvedValue({ channel: "sms" });
      api.auth.otpVerify.mockResolvedValue({ isNew: false });
      mount();
      await screen.findByText("Booking as Ana");
      fireEvent.click(screen.getByRole("button", { name: "Not you?" }));
      api.me.get.mockReturnValue(new Promise(() => undefined));
      fireEvent.change(await screen.findByLabelText("Your mobile number"), { target: { value: "7185550124" } });
      fireEvent.click(screen.getByRole("button", { name: "Send code" }));
      fireEvent.change(await screen.findByLabelText(CODE_LABEL), { target: { value: "123456" } });
      fireEvent.click(screen.getByRole("button", { name: "Verify code" }));
      expect(await screen.findByText("Checking your session…")).toBeInTheDocument();
      expect(screen.queryByText("Booking as Ana")).not.toBeInTheDocument();
    });
  });
});
