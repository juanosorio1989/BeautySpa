import { ApiError } from "@beautyspa/api-client";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { en } from "@beautyspa/i18n";

const auth = {
  staffLogin: vi.fn(),
  mfaVerify: vi.fn(),
  mfaRecover: vi.fn(),
  mfaEnrollStart: vi.fn(),
  mfaEnrollConfirm: vi.fn(),
};
vi.mock("@/lib/api/browser", () => ({ getBrowserApi: () => ({ auth }) }));
const signedIn = vi.fn();
vi.mock("@/lib/session/use-session", () => ({ useSession: () => ({ status: "signedOut", signedIn }) }));
vi.mock("qrcode", () => ({ default: { toDataURL: vi.fn().mockResolvedValue("data:image/png;base64,AAA") } }));

import { StaffLoginFlow, type InitialStep } from "./staff-login-flow";

const onDone = vi.fn();
const mount = (initialStep?: InitialStep) =>
  render(
    <NextIntlClientProvider locale="en" messages={en}>
      <StaffLoginFlow onDone={onDone} {...(initialStep ? { initialStep } : {})} />
    </NextIntlClientProvider>,
  );
const step = (status: "MFA_REQUIRED" | "ENROLL_REQUIRED") => ({
  status,
  mfaToken: "mfa-1",
  mfaTokenExpiresAt: "2026-11-27T12:00:00.000Z",
});
const unauthorized = () => new ApiError(401, { type: "about:blank", title: "x", status: 401, code: "UNAUTHORIZED" });
const CODES = Array.from({ length: 10 }, (_, i) => `code-${i}`);

function signInWithPassword() {
  fireEvent.change(screen.getByLabelText("Email"), { target: { value: "ana@example.com" } });
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: "pw" } });
  fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
}
const enterCode = (code: string) =>
  fireEvent.change(screen.getByLabelText("6-digit code from your authenticator app"), { target: { value: code } });

beforeEach(() => {
  for (const fn of Object.values(auth)) fn.mockReset();
  signedIn.mockReset();
  onDone.mockReset();
});

describe("StaffLoginFlow", () => {
  it("MFA_REQUIRED goes to code and signs in", async () => {
    auth.staffLogin.mockResolvedValue(step("MFA_REQUIRED"));
    auth.mfaVerify.mockResolvedValue({});
    mount();
    signInWithPassword();
    await screen.findByLabelText("6-digit code from your authenticator app");
    expect(auth.staffLogin).toHaveBeenCalledWith({ email: "ana@example.com", password: "pw" });
    enterCode("123456");
    fireEvent.click(screen.getByRole("button", { name: "Verify" }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(auth.mfaVerify).toHaveBeenCalledWith({ mfaToken: "mfa-1", code: "123456" });
    expect(signedIn).toHaveBeenCalled();
  });

  it("ENROLL_REQUIRED shows QR and recovery codes, Continue disabled until saved", async () => {
    auth.staffLogin.mockResolvedValue(step("ENROLL_REQUIRED"));
    auth.mfaEnrollStart.mockResolvedValue({ secret: "SECRET123", otpauthUrl: "otpauth://totp/x" });
    auth.mfaEnrollConfirm.mockResolvedValue({ recoveryCodes: CODES });
    mount();
    signInWithPassword();
    const qr = await screen.findByRole("img", { name: /QR code/ });
    expect(qr).toHaveAttribute("src", "data:image/png;base64,AAA");
    expect(screen.getByText("SECRET123")).toBeInTheDocument();
    enterCode("654321");
    fireEvent.click(screen.getByRole("button", { name: "Confirm and continue" }));
    await screen.findByText("code-9");
    expect(auth.mfaEnrollConfirm).toHaveBeenCalledWith({ mfaToken: "mfa-1", code: "654321" });
    expect(screen.getAllByRole("listitem")).toHaveLength(10);
    const cont = screen.getByRole("button", { name: "Continue" });
    expect(cont).toBeDisabled();
    fireEvent.click(screen.getByLabelText("I saved them"));
    expect(cont).toBeEnabled();
    fireEvent.click(cont);
    expect(onDone).toHaveBeenCalled();
  });

  it("recovery code leads to enrollment, not sign-in", async () => {
    auth.mfaRecover.mockResolvedValue({ ...step("ENROLL_REQUIRED"), mfaToken: "mfa-2" });
    auth.mfaEnrollStart.mockResolvedValue({ secret: "S2", otpauthUrl: "otpauth://totp/y" });
    mount({ status: "MFA_REQUIRED", mfaToken: "mfa-1" });
    fireEvent.click(screen.getByRole("button", { name: "Use a recovery code" }));
    fireEvent.change(screen.getByLabelText("Recovery code"), { target: { value: "abcd-efgh" } });
    fireEvent.click(screen.getByRole("button", { name: "Use this code" }));
    await screen.findByRole("img", { name: /QR code/ });
    expect(auth.mfaRecover).toHaveBeenCalledWith({ mfaToken: "mfa-1", recoveryCode: "abcd-efgh" });
    expect(auth.mfaEnrollStart).toHaveBeenCalledWith({ mfaToken: "mfa-2" });
    expect(onDone).not.toHaveBeenCalled();
    expect(signedIn).not.toHaveBeenCalled();
  });

  it("invite accept starts at enrollment", async () => {
    auth.mfaEnrollStart.mockResolvedValue({ secret: "S3", otpauthUrl: "otpauth://totp/z" });
    mount({ status: "ENROLL_REQUIRED", mfaToken: "mfa-9" });
    await screen.findByRole("img", { name: /QR code/ });
    expect(screen.queryByLabelText("Email")).not.toBeInTheDocument();
    expect(auth.mfaEnrollStart).toHaveBeenCalledWith({ mfaToken: "mfa-9" });
  });

  it("wrong code shows the MFA_INVALID text", async () => {
    auth.mfaVerify.mockRejectedValue(
      new ApiError(400, { type: "about:blank", title: "x", status: 400, code: "MFA_INVALID" }),
    );
    mount({ status: "MFA_REQUIRED", mfaToken: "mfa-1" });
    enterCode("111111");
    fireEvent.click(screen.getByRole("button", { name: "Verify" }));
    expect(await screen.findByText("That code is not right.")).toBeInTheDocument();
    expect(onDone).not.toHaveBeenCalled();
  });

  it("wrong password says the email or password is not right", async () => {
    auth.staffLogin.mockRejectedValue(unauthorized());
    mount();
    signInWithPassword();
    expect(await screen.findByText("Email or password is not right.")).toBeInTheDocument();
    expect(screen.queryByText("Please log in to continue.")).toBeNull();
  });

  it("an expired sign-in on the code step offers Start over back to the password", async () => {
    auth.mfaVerify.mockRejectedValue(unauthorized());
    mount({ status: "MFA_REQUIRED", mfaToken: "mfa-1" });
    enterCode("111111");
    fireEvent.click(screen.getByRole("button", { name: "Verify" }));
    expect(await screen.findByText("Sign-in timed out. Start again.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Start over" }));
    expect(screen.getByLabelText("Email")).toBeInTheDocument();
    expect(screen.getByLabelText("Password")).toHaveValue("");
    expect(screen.queryByText("Sign-in timed out. Start again.")).toBeNull();
  });

  it("an expired sign-in on the recovery step offers Start over", async () => {
    auth.mfaRecover.mockRejectedValue(unauthorized());
    mount({ status: "MFA_REQUIRED", mfaToken: "mfa-1" });
    fireEvent.click(screen.getByRole("button", { name: "Use a recovery code" }));
    fireEvent.change(screen.getByLabelText("Recovery code"), { target: { value: "abcd-efgh" } });
    fireEvent.click(screen.getByRole("button", { name: "Use this code" }));
    expect(await screen.findByText("Sign-in timed out. Start again.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Start over" }));
    expect(screen.getByLabelText("Email")).toBeInTheDocument();
  });

  it("an expired sign-in on enrollment offers Start over", async () => {
    auth.mfaEnrollStart.mockResolvedValue({ secret: "S3", otpauthUrl: "otpauth://totp/z" });
    auth.mfaEnrollConfirm.mockRejectedValue(unauthorized());
    mount({ status: "ENROLL_REQUIRED", mfaToken: "mfa-9" });
    await screen.findByRole("img", { name: /QR code/ });
    enterCode("654321");
    fireEvent.click(screen.getByRole("button", { name: "Confirm and continue" }));
    expect(await screen.findByText("Sign-in timed out. Start again.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Start over" }));
    expect(screen.getByLabelText("Email")).toBeInTheDocument();
  });

  it("an enrollment load error offers Try again and a link back to sign in", async () => {
    auth.mfaEnrollStart
      .mockRejectedValueOnce(new ApiError(500, { type: "about:blank", title: "x", status: 500, code: "INTERNAL" }))
      .mockResolvedValueOnce({ secret: "S4", otpauthUrl: "otpauth://totp/w" });
    mount({ status: "ENROLL_REQUIRED", mfaToken: "mfa-9" });
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to sign in" })).toHaveAttribute("href", "/en/staff/login");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("S4")).toBeInTheDocument();
    expect(auth.mfaEnrollStart).toHaveBeenCalledTimes(2);
  });

  it("an expired token while loading enrollment offers Start over", async () => {
    auth.mfaEnrollStart.mockRejectedValue(unauthorized());
    mount({ status: "ENROLL_REQUIRED", mfaToken: "mfa-9" });
    expect(await screen.findByText("Sign-in timed out. Start again.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Start over" }));
    expect(screen.getByLabelText("Email")).toBeInTheDocument();
  });
});
