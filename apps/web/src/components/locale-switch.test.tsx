import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it, vi } from "vitest";
import { es } from "@beautyspa/i18n";
import { LocaleSwitch } from "./locale-switch";

let search = "";
vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  useSearchParams: () => new URLSearchParams(search),
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
    expect(screen.getByRole("link", { name: "Inglés" })).toHaveAttribute("href", "/en/services");
    expect(screen.getByRole("link", { name: "Español" })).toHaveAttribute("aria-current", "true");
  });

  it("keeps the query string (e.g. the login next) when switching language", () => {
    search = "next=%2Fes%2Fme";
    render(
      <NextIntlClientProvider locale="es" messages={es}>
        <LocaleSwitch />
      </NextIntlClientProvider>,
    );
    expect(screen.getByRole("link", { name: "Inglés" })).toHaveAttribute("href", "/en/services?next=%2Fes%2Fme");
    search = "";
  });
});
