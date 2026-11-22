import { ApiError } from "@beautyspa/api-client";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { en } from "@beautyspa/i18n";

const otpStart = vi.fn();
const otpVerify = vi.fn();
vi.mock("@/lib/api/browser", () => ({ getBrowserApi: () => ({ auth: { otpStart, otpVerify } }) }));
const signedIn = vi.fn();
vi.mock("@/lib/session/use-session", () => ({ useSession: () => ({ status: "signedOut", signedIn }) }));

import { OtpFlow } from "./otp-flow";

const apiError = (status: number, code: "OTP_INVALID" | "RATE_LIMITED") =>
  new ApiError(status, { type: "about:blank", title: "x", status, code });

const onVerified = vi.fn();
const mount = (locale: "en" | "es" = "en") =>
  render(
    <NextIntlClientProvider locale={locale} messages={en}>
      <OtpFlow onVerified={onVerified} />
    </NextIntlClientProvider>,
  );

async function sendCode(channel: "sms" | "whatsapp" = "sms") {
  otpStart.mockResolvedValueOnce({ channel });
  fireEvent.change(screen.getByLabelText("Your mobile number"), { target: { value: "7185550123" } });
  fireEvent.click(screen.getByRole("button", { name: "Send code" }));
  await screen.findByLabelText("6-digit code");
}

describe("OtpFlow", () => {
  beforeEach(() => {
    otpStart.mockReset();
    otpVerify.mockReset();
    signedIn.mockReset();
    onVerified.mockReset();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("formats the phone while typing and sends E.164 with the page locale", async () => {
    mount();
    const input = screen.getByLabelText("Your mobile number") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "7185550123" } });
    expect(input.value).toBe("(718) 555-0123");
    otpStart.mockResolvedValueOnce({ channel: "sms" });
    fireEvent.click(screen.getByRole("button", { name: "Send code" }));
    await screen.findByLabelText("6-digit code");
    expect(otpStart).toHaveBeenCalledWith({ phone: "+17185550123", locale: "en" });
  });

  it("rejects an invalid phone without calling the API", () => {
    mount();
    fireEvent.change(screen.getByLabelText("Your mobile number"), { target: { value: "123" } });
    fireEvent.click(screen.getByRole("button", { name: "Send code" }));
    expect(screen.getByText("Enter a valid US mobile number.")).toBeInTheDocument();
    expect(otpStart).not.toHaveBeenCalled();
  });

  it("code label names the channel (whatsapp vs sms)", async () => {
    mount();
    await sendCode("whatsapp");
    expect(screen.getByText("We sent you a code on WhatsApp")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Change number" }));
    await sendCode("sms");
    expect(screen.getByText("We texted you a code")).toBeInTheDocument();
    const code = screen.getByLabelText("6-digit code");
    expect(code).toHaveAttribute("inputmode", "numeric");
    expect(code).toHaveAttribute("autocomplete", "one-time-code");
  });

  it("verifies the code, marks the session signed in and notifies", async () => {
    mount();
    await sendCode();
    otpVerify.mockResolvedValueOnce({ isNew: true });
    fireEvent.change(screen.getByLabelText("6-digit code"), { target: { value: "481923" } });
    fireEvent.click(screen.getByRole("button", { name: "Verify code" }));
    await waitFor(() => expect(onVerified).toHaveBeenCalled());
    expect(otpVerify).toHaveBeenCalledWith({ phone: "+17185550123", code: "481923", locale: "en" });
    expect(signedIn).toHaveBeenCalled();
  });

  it("OTP_INVALID shows the inline code error", async () => {
    mount();
    await sendCode();
    otpVerify.mockRejectedValueOnce(apiError(400, "OTP_INVALID"));
    fireEvent.change(screen.getByLabelText("6-digit code"), { target: { value: "000000" } });
    fireEvent.click(screen.getByRole("button", { name: "Verify code" }));
    expect(await screen.findByText("That code is not right.")).toBeInTheDocument();
    expect(onVerified).not.toHaveBeenCalled();
  });

  it("resend is disabled for 30 s, then calls start again", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
    mount();
    await sendCode();
    const resend = () => screen.getByRole("button", { name: /Resend code/ });
    expect(resend()).toBeDisabled();
    expect(resend()).toHaveTextContent("Resend code in 30 s");
    act(() => {
      vi.advanceTimersByTime(29_000);
    });
    expect(resend()).toBeDisabled();
    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    expect(resend()).toBeEnabled();
    otpStart.mockResolvedValueOnce({ channel: "sms" });
    fireEvent.click(resend());
    await waitFor(() => expect(otpStart).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(resend()).toBeDisabled());
  });
});
