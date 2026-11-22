import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it, vi } from "vitest";
import { es } from "@beautyspa/i18n";
import { LocaleSwitch } from "./locale-switch";

vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  usePathname: () => "/es/services",
  useParams: () => ({ locale: "es" }),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
}));

describe("LocaleSwitch", () => {
  it("keeps the current path when switching language", () => {
    render(
      <NextIntlClientProvider locale="es" messages={es}>
        <LocaleSwitch />
      </NextIntlClientProvider>,
    );
    expect(screen.getByRole("link", { name: "EN" })).toHaveAttribute("href", "/en/services");
    expect(screen.getByRole("link", { name: "ES" })).toHaveAttribute("aria-current", "true");
  });
});
