import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { en } from "@beautyspa/i18n";

const push = vi.fn();
let search = "";
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(search),
}));
vi.mock("@/i18n/navigation", () => ({ Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a> }));

const api = { auth: { otpStart: vi.fn(), otpVerify: vi.fn() } };
vi.mock("@/lib/api/browser", () => ({ getBrowserApi: () => api }));
const signedIn = vi.fn();
vi.mock("@/lib/session/use-session", () => ({ useSession: () => ({ status: "signedOut", signedIn }) }));

import LoginPage from "./page";

async function login() {
  render(
    <NextIntlClientProvider locale="en" messages={en}>
      <LoginPage />
    </NextIntlClientProvider>,
  );
  api.auth.otpStart.mockResolvedValue({ channel: "sms" });
  api.auth.otpVerify.mockResolvedValue({ isNew: false });
  fireEvent.change(screen.getByLabelText("Your mobile number"), { target: { value: "7185550123" } });
  fireEvent.click(screen.getByRole("button", { name: "Send code" }));
  fireEvent.change(await screen.findByLabelText("6-digit code"), { target: { value: "123456" } });
  fireEvent.click(screen.getByRole("button", { name: "Verify code" }));
}

describe("/login", () => {
  beforeEach(() => {
    push.mockReset();
    signedIn.mockReset();
  });

  it("login returns to next after verify", async () => {
    search = "next=" + encodeURIComponent("/en/book/done/abc");
    await login();
    await waitFor(() => expect(push).toHaveBeenCalledWith("/en/book/done/abc"));
  });

  it("an unsafe next goes to /<locale>/me", async () => {
    search = "next=" + encodeURIComponent("//evil.example");
    await login();
    await waitFor(() => expect(push).toHaveBeenCalledWith("/en/me"));
  });
});
