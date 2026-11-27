import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { en } from "@beautyspa/i18n";

let query = "";
vi.mock("next/navigation", async (orig) => ({
  ...(await orig<typeof import("next/navigation")>()),
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(query),
}));
const inviteAccept = vi.fn();
const mfaEnrollStart = vi.fn();
vi.mock("@/lib/api/browser", () => ({ getBrowserApi: () => ({ auth: { inviteAccept, mfaEnrollStart } }) }));
vi.mock("@/lib/session/use-session", () => ({ useSession: () => ({ status: "signedOut", signedIn: vi.fn() }) }));
vi.mock("qrcode", () => ({ default: { toDataURL: vi.fn().mockResolvedValue("data:image/png;base64,AAA") } }));

import StaffInvitePage from "./page";

const mount = () =>
  render(
    <NextIntlClientProvider locale="en" messages={en}>
      <StaffInvitePage />
    </NextIntlClientProvider>,
  );
const TOKEN = "t".repeat(30);

beforeEach(() => {
  query = `token=${TOKEN}`;
  inviteAccept.mockReset();
  mfaEnrollStart.mockReset();
});

describe("staff invite page", () => {
  it("missing token shows the invalid link message", () => {
    query = "";
    mount();
    expect(screen.getByText("This link is not valid")).toBeInTheDocument();
  });

  it("rejects mismatched and short passwords without calling the API", () => {
    mount();
    fireEvent.change(screen.getByLabelText("New password"), { target: { value: "short" } });
    fireEvent.change(screen.getByLabelText("Confirm password"), { target: { value: "short" } });
    fireEvent.click(screen.getByRole("button", { name: "Save password" }));
    expect(screen.getByText("Use at least 12 characters.")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("New password"), { target: { value: "a-long-password-1" } });
    fireEvent.click(screen.getByRole("button", { name: "Save password" }));
    expect(screen.getByText("The passwords do not match.")).toBeInTheDocument();
    expect(inviteAccept).not.toHaveBeenCalled();
  });

  it("invite accept starts at enrollment", async () => {
    inviteAccept.mockResolvedValue({ status: "ENROLL_REQUIRED", mfaToken: "m1", mfaTokenExpiresAt: "x" });
    mfaEnrollStart.mockResolvedValue({ secret: "S", otpauthUrl: "otpauth://totp/a" });
    mount();
    for (const label of ["New password", "Confirm password"])
      fireEvent.change(screen.getByLabelText(label), { target: { value: "a-long-password-1" } });
    fireEvent.click(screen.getByRole("button", { name: "Save password" }));
    await screen.findByRole("img", { name: /QR code/ });
    expect(inviteAccept).toHaveBeenCalledWith({ token: TOKEN, password: "a-long-password-1" });
    await waitFor(() => expect(mfaEnrollStart).toHaveBeenCalledWith({ mfaToken: "m1" }));
  });
});
