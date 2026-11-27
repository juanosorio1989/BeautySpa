import { ApiError } from "@beautyspa/api-client";
import { render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { en } from "@beautyspa/i18n";

let query = "";
const replace = vi.fn();
const push = vi.fn();
vi.mock("next/navigation", async (orig) => ({
  ...(await orig<typeof import("next/navigation")>()),
  useRouter: () => ({ replace, push }),
  useSearchParams: () => new URLSearchParams(query),
}));
vi.mock("next-intl", async (orig) => ({ ...(await orig<typeof import("next-intl")>()), useLocale: () => "es" }));
const me = vi.fn();
const mfaVerify = vi.fn();
vi.mock("@/lib/api/browser", () => ({ getBrowserApi: () => ({ staff: { me }, auth: { mfaVerify } }) }));
const ensure = vi.fn();
vi.mock("@/lib/session/use-session", () => ({
  useSession: () => ({ status: "signedOut", ensure, signedIn: vi.fn() }),
}));

import StaffLoginPage from "./page";

const mount = () =>
  render(
    <NextIntlClientProvider locale="en" messages={en}>
      <StaffLoginPage />
    </NextIntlClientProvider>,
  );

beforeEach(() => {
  query = "";
  replace.mockReset();
  push.mockReset();
  me.mockReset();
  ensure.mockReset().mockResolvedValue(false);
});

describe("staff login page", () => {
  it("customer session shows the notice", async () => {
    ensure.mockResolvedValue(true);
    me.mockRejectedValue(new ApiError(403, { type: "about:blank", title: "x", status: 403, code: "FORBIDDEN" }));
    mount();
    expect(await screen.findByText(en.staff.auth.customerNotice)).toBeInTheDocument();
  });

  it("customer=1 shows the notice", () => {
    query = "customer=1";
    mount();
    expect(screen.getByText(en.staff.auth.customerNotice)).toBeInTheDocument();
  });

  it("signed-out visitor sees no notice", async () => {
    mount();
    await waitFor(() => expect(ensure).toHaveBeenCalled());
    expect(screen.queryByText(en.staff.auth.customerNotice)).not.toBeInTheDocument();
  });

  it("an active staff session goes to next", async () => {
    query = "next=%2Fes%2Fstaff%2Fclients";
    ensure.mockResolvedValue(true);
    me.mockResolvedValue({});
    mount();
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/es/staff/clients"));
  });

  it("next is sanitized", async () => {
    query = "next=%2F%2Fevil.com";
    ensure.mockResolvedValue(true);
    me.mockResolvedValue({});
    mount();
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/es/staff"));
  });
});
