import { ApiError } from "@beautyspa/api-client";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { en } from "@beautyspa/i18n";

const passwordForgot = vi.fn();
vi.mock("@/lib/api/browser", () => ({ getBrowserApi: () => ({ auth: { passwordForgot } }) }));

import StaffForgotPage from "./page";

async function submit() {
  render(
    <NextIntlClientProvider locale="en" messages={en}>
      <StaffForgotPage />
    </NextIntlClientProvider>,
  );
  fireEvent.change(screen.getByLabelText("Email"), { target: { value: "x@example.com" } });
  fireEvent.click(screen.getByRole("button", { name: "Send link" }));
  return screen.findByText(en.staff.auth.forgotSent);
}

beforeEach(() => passwordForgot.mockReset());

describe("staff forgot page", () => {
  it("shows the same message on 204 and 404-like responses", async () => {
    passwordForgot.mockResolvedValueOnce(undefined);
    const ok = await submit();
    expect(ok.textContent).toBe(en.staff.auth.forgotSent);
    cleanup();
    passwordForgot.mockRejectedValueOnce(
      new ApiError(404, { type: "about:blank", title: "x", status: 404, code: "NOT_FOUND" }),
    );
    const missing = await submit();
    expect(missing.textContent).toBe(ok.textContent);
  });
});
