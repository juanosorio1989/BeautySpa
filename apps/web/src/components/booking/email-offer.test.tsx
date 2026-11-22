import { ApiError } from "@beautyspa/api-client";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { en } from "@beautyspa/i18n";
import { me } from "./test-fixtures";

const patch = vi.fn();
vi.mock("@/lib/api/browser", () => ({ getBrowserApi: () => ({ me: { patch } }) }));

import { EmailOffer } from "./email-offer";

const mount = (email: string | null = null, onSaved = vi.fn()) => {
  render(
    <NextIntlClientProvider locale="en" messages={en}>
      <EmailOffer email={email} onSaved={onSaved} />
    </NextIntlClientProvider>,
  );
  return onSaved;
};

describe("EmailOffer", () => {
  beforeEach(() => patch.mockReset());

  it('sends PATCH /me { email, consents: { EMAIL: true }, consentSource: "BOOKING_FORM" } and hides', async () => {
    patch.mockResolvedValueOnce(me({ email: "a@b.co", consents: { WHATSAPP: false, SMS: false, EMAIL: true } }));
    const onSaved = mount();
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "a@b.co" } });
    fireEvent.click(screen.getByRole("button", { name: "Yes, email me" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(patch).toHaveBeenCalledWith({
      email: "a@b.co",
      consents: { EMAIL: true },
      consentSource: "BOOKING_FORM",
    });
    expect(screen.queryByText("Want your confirmation and reminders by email?")).not.toBeInTheDocument();
  });

  it("prefills a known email and shows an API error", async () => {
    patch.mockRejectedValueOnce(
      new ApiError(429, { type: "about:blank", title: "x", status: 429, code: "RATE_LIMITED" }),
    );
    mount("known@b.co");
    expect(screen.getByLabelText("Email")).toHaveValue("known@b.co");
    fireEvent.click(screen.getByRole("button", { name: "Yes, email me" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Too many tries");
    expect(screen.getByText("Want your confirmation and reminders by email?")).toBeInTheDocument();
  });
});
