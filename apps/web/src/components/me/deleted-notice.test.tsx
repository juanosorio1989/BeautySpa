import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it, vi } from "vitest";
import { en } from "@beautyspa/i18n";

let query = "";
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(query) }));

import { DeletedNotice } from "./deleted-notice";

const mount = () =>
  render(
    <NextIntlClientProvider locale="en" messages={en}>
      <DeletedNotice />
    </NextIntlClientProvider>,
  );

describe("DeletedNotice", () => {
  it("shows the deleted notice with ?deleted=1", () => {
    query = "deleted=1";
    mount();
    expect(screen.getByRole("status")).toHaveTextContent("Your account was deleted.");
  });
  it("shows nothing otherwise", () => {
    query = "";
    mount();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});
