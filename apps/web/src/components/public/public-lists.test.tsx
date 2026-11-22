import { render, screen, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import type { PublicEmployee, PublicLocation, PublicService } from "@beautyspa/contracts";
import { en, es } from "@beautyspa/i18n";
import { LocationHours } from "./location-hours";
import { ServicesList } from "./services-list";
import { TeamList } from "./team-list";

vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  usePathname: () => "/en/services",
  useParams: () => ({ locale: "en" }),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
}));

const wrap = (ui: ReactNode, locale: "en" | "es" = "en") =>
  render(
    <NextIntlClientProvider locale={locale} messages={locale === "en" ? en : es}>
      {ui}
    </NextIntlClientProvider>,
  );

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const svc = (n: number, over: Partial<PublicService> = {}): PublicService => ({
  id: id(n),
  categoryId: id(100),
  name: { en: `Svc ${n}`, es: `Serv ${n}` },
  description: null,
  durationMin: 30,
  priceCents: 5000,
  fromPriceCents: 5000,
  parallelizable: false,
  ...over,
});

describe("ServicesList", () => {
  const data = {
    categories: [
      { id: id(100), name: { en: "Nails", es: "Uñas" }, sort: 1 },
      { id: id(101), name: { en: "Hair", es: "Cabello" }, sort: 0 },
    ],
    services: [svc(1), svc(2, { fromPriceCents: 4000, categoryId: id(101) }), svc(3, { categoryId: null })],
  };

  it("groups by category, shows 'from $X' only when fromPriceCents differs", () => {
    wrap(<ServicesList data={data} locale="en" />);
    const headings = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
    expect(headings).toEqual(["Hair", "Nails", en.services.uncategorized]);
    const hair = within(screen.getByRole("heading", { name: "Hair" }).closest("section")!);
    expect(hair.getByText("from $40.00")).toBeInTheDocument();
    const nails = within(screen.getByRole("heading", { name: "Nails" }).closest("section")!);
    expect(nails.getByText("$50.00")).toBeInTheDocument();
    expect(nails.queryByText(/from/)).toBeNull();
  });

  it("links each service to /<locale>?service=<id>", () => {
    wrap(<ServicesList data={data} locale="en" />);
    expect(screen.getByRole("link", { name: /Svc 1/ })).toHaveAttribute("href", `/en?service=${id(1)}`);
  });

  it("falls back to the other language when the text is empty", () => {
    wrap(<ServicesList data={{ ...data, services: [svc(1, { name: { en: "", es: "Solo es" } })] }} locale="en" />);
    expect(screen.getByRole("heading", { name: "Solo es" })).toBeInTheDocument();
  });
});

describe("TeamList", () => {
  const emp = (n: number, over: Partial<PublicEmployee> = {}): PublicEmployee => ({
    id: id(n),
    displayName: `Ana Lopez ${n}`,
    bio: null,
    photoUrl: null,
    level: null,
    serviceIds: [id(1)],
    ...over,
  });

  it("hides employees with empty serviceIds and shows initials and services", () => {
    wrap(<TeamList employees={[emp(1), emp(2, { serviceIds: [] })]} services={[svc(1)]} locale="en" />);
    expect(screen.getByText("Ana Lopez 1")).toBeInTheDocument();
    expect(screen.queryByText("Ana Lopez 2")).toBeNull();
    expect(screen.getByText("AL")).toBeInTheDocument();
    expect(screen.getByText("Svc 1")).toBeInTheDocument();
  });
});

describe("LocationHours", () => {
  const location: PublicLocation = {
    id: id(9),
    name: "Salon",
    address: "1 Main St, Miami FL",
    phone: "+13055550100",
    timezone: "America/New_York",
    hours: [
      { weekday: 1, start: "09:00", end: "17:00" },
      { weekday: 2, start: "09:00", end: "12:00" },
      { weekday: 2, start: "13:00", end: "17:00" },
    ],
    booking: { bookingHorizonDays: 30, cancelWindowHours: 24, holdMinutes: 10 },
  };

  it("renders weekly hours, tap-to-call link and map link", () => {
    wrap(<LocationHours location={location} locale="en" />);
    expect(screen.getByRole("link", { name: "+13055550100" })).toHaveAttribute("href", "tel:+13055550100");
    expect(screen.getByRole("link", { name: en.location.openMap })).toHaveAttribute(
      "href",
      "https://maps.google.com/?q=1%20Main%20St%2C%20Miami%20FL",
    );
    expect(screen.getByText(/9:00 AM – 5:00 PM/)).toBeInTheDocument();
    expect(screen.getByText(/9:00 AM – 12:00 PM, 1:00 PM – 5:00 PM/)).toBeInTheDocument();
    expect(screen.getAllByText(en.location.closed)).toHaveLength(5);
  });

  it("localizes weekday names", () => {
    wrap(<LocationHours location={location} locale="es" />, "es");
    expect(screen.getByText("Lunes")).toBeInTheDocument();
  });
});
