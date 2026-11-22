import { describe, expect, it, vi } from "vitest";
import { es } from "@beautyspa/i18n";

vi.mock("server-only", () => ({}));
vi.mock("next-intl/server", () => ({
  setRequestLocale: vi.fn(),
  getTranslations: async () => (key: string) =>
    key.split(".").reduce<unknown>((o, k) => (o as Record<string, unknown>)[k], es.seo) as string,
}));

import { generateMetadata } from "./page";

describe("home page metadata", () => {
  it("uses the home SEO keys with the bare locale as canonical path", async () => {
    const m = await generateMetadata({ params: Promise.resolve({ locale: "es" }) });
    expect(m).toMatchObject({ title: es.seo.home.title, alternates: { canonical: expect.stringMatching(/\/es$/) } });
  });

  it("returns nothing for an unknown locale", async () => {
    expect(await generateMetadata({ params: Promise.resolve({ locale: "fr" }) })).toEqual({});
  });
});
