import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { en, es } from "@beautyspa/i18n";
import { pageMetadata } from "./seo";

vi.mock("next-intl/server", () => ({
  getTranslations:
    async ({ locale, namespace }: { locale: "en" | "es"; namespace: string }) =>
    (key: string) =>
      `${namespace}.${key}`
        .split(".")
        .reduce<unknown>((o, k) => (o as Record<string, unknown>)[k], { en, es }[locale]) as string,
}));

describe("pageMetadata", () => {
  beforeEach(() => vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://spa.example/"));
  afterEach(() => vi.unstubAllEnvs());

  it("sets hreflang en, es and x-default plus canonical", async () => {
    const m = await pageMetadata("es", "/services", "services.title", "services.description");
    expect(m.title).toBe(es.seo.services.title);
    expect(m.description).toBe(es.seo.services.description);
    expect(m.alternates).toEqual({
      canonical: "https://spa.example/es/services",
      languages: {
        en: "https://spa.example/en/services",
        es: "https://spa.example/es/services",
        "x-default": "https://spa.example/en/services",
      },
    });
  });
});
