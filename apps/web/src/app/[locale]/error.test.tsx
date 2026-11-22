import { fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it, vi } from "vitest";
import { en } from "@beautyspa/i18n";
import LocaleError from "./error";

describe("LocaleError", () => {
  it("shows the generic copy and calls reset on retry", () => {
    const reset = vi.fn();
    render(
      <NextIntlClientProvider locale="en" messages={en}>
        <LocaleError error={new Error("boom")} reset={reset} />
      </NextIntlClientProvider>,
    );
    expect(screen.getByText(en.errors.generic)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: en.common.retry }));
    expect(reset).toHaveBeenCalledOnce();
  });

  it("shows the network copy for a TypeError", () => {
    render(
      <NextIntlClientProvider locale="en" messages={en}>
        <LocaleError error={new TypeError("fetch failed")} reset={() => {}} />
      </NextIntlClientProvider>,
    );
    expect(screen.getByText(en.errors.network)).toBeInTheDocument();
  });
});
