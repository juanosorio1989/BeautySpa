import { fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { en } from "@beautyspa/i18n";

let query = "";
vi.mock("next/navigation", async (orig) => ({
  ...(await orig<typeof import("next/navigation")>()),
  useSearchParams: () => new URLSearchParams(query),
}));
const passwordReset = vi.fn();
vi.mock("@/lib/api/browser", () => ({ getBrowserApi: () => ({ auth: { passwordReset } }) }));

import StaffResetPage from "./page";

const mount = () =>
  render(
    <NextIntlClientProvider locale="en" messages={en}>
      <StaffResetPage />
    </NextIntlClientProvider>,
  );

beforeEach(() => {
  query = `token=${"t".repeat(30)}`;
  passwordReset.mockReset();
});

describe("staff reset page", () => {
  it("missing token shows the invalid link message with a login link", () => {
    query = "";
    mount();
    expect(screen.getByText("This link is not valid")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to sign in" })).toHaveAttribute("href", "/en/staff/login");
  });

  it("changes the password and links to login", async () => {
    passwordReset.mockResolvedValue(undefined);
    mount();
    for (const label of ["New password", "Confirm password"])
      fireEvent.change(screen.getByLabelText(label), { target: { value: "a-long-password-1" } });
    fireEvent.click(screen.getByRole("button", { name: "Change password" }));
    expect(await screen.findByText("Password changed")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to sign in" })).toBeInTheDocument();
  });
});
