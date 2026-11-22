import { renderToString } from "react-dom/server";
import { fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PublicServicesResponse } from "@beautyspa/contracts";
import { en } from "@beautyspa/i18n";
import { bookingStore } from "@/lib/booking/store";
import { id, svc } from "./test-fixtures";

const push = vi.fn();
let search = "";
vi.mock("@/i18n/navigation", () => ({
  useRouter: () => ({ push, replace: vi.fn() }),
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(search) }));

import { ServicePicker } from "./service-picker";

const data: PublicServicesResponse = {
  categories: [
    { id: id(100), name: { en: "Nails", es: "Uñas" }, sort: 0 },
    { id: id(101), name: { en: "Hair", es: "Cabello" }, sort: 1 },
  ],
  services: [
    svc(1, { parallelizable: true }),
    svc(2, { parallelizable: true, durationMin: 45, priceCents: 4000, fromPriceCents: 3500 }),
    svc(3),
    svc(4),
    svc(5),
    svc(6, { categoryId: id(101) }),
  ],
};

const renderPicker = () =>
  render(
    <NextIntlClientProvider locale="en" messages={en}>
      <ServicePicker data={data} locale="en" />
    </NextIntlClientProvider>,
  );

describe("ServicePicker", () => {
  beforeEach(() => {
    sessionStorage.clear();
    bookingStore.reset();
    push.mockReset();
    search = "";
  });

  it("lists the first category, filters by chip, and shows duration, parallel hint and 'from' price", () => {
    renderPicker();
    expect(screen.getByRole("checkbox", { name: /Svc 1/ })).toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: /Svc 6/ })).toBeNull();
    expect(screen.getAllByText(/Can be done at the same time/)).toHaveLength(2);
    expect(screen.getByText("from $35.00")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Hair" }));
    expect(screen.getByRole("checkbox", { name: /Svc 6/ })).toBeInTheDocument();
  });

  it("keeps Continue disabled with no services, then summarizes count, duration and from-total", () => {
    renderPicker();
    expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox", { name: /Svc 1/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: /Svc 2/ }));
    expect(screen.getByText("2 services · about 45 min")).toBeInTheDocument();
    expect(screen.getByText("from $60.00")).toBeInTheDocument();
    const next = screen.getByRole("button", { name: "Continue" });
    expect(next).toBeEnabled();
    fireEvent.click(next);
    expect(push).toHaveBeenCalledWith("/book/time");
  });

  it("refuses a fifth service with a notice", () => {
    renderPicker();
    for (const n of [1, 2, 3, 4]) fireEvent.click(screen.getByRole("checkbox", { name: new RegExp(`Svc ${n}\\b`) }));
    fireEvent.click(screen.getByRole("checkbox", { name: /Svc 5/ }));
    expect(screen.getByRole("status")).toHaveTextContent(en.booking.services.limit);
    expect(screen.getByRole("checkbox", { name: /Svc 5/ })).not.toBeChecked();
  });

  it("?service=<id> preselects it on step 1", () => {
    search = `service=${id(3)}`;
    renderPicker();
    expect(screen.getByRole("checkbox", { name: /Svc 3/ })).toBeChecked();
    expect(bookingStore.getState().serviceIds).toEqual([id(3)]);
  });

  it("?service= with four services already chosen shows the limit notice", () => {
    for (const n of [1, 2, 3, 4]) bookingStore.toggleService(id(n));
    search = `service=${id(5)}`;
    renderPicker();
    expect(screen.getByRole("status")).toHaveTextContent(en.booking.services.limit);
    expect(bookingStore.getState().serviceIds).toHaveLength(4);
  });

  it("renders the service list on the server (no search-params bailout)", () => {
    const html = renderToString(
      <NextIntlClientProvider locale="en" messages={en}>
        <ServicePicker data={data} locale="en" />
      </NextIntlClientProvider>,
    );
    expect(html).toContain("Svc 1");
  });

  it("?service= preselects a service from another category and shows that category", () => {
    search = `service=${id(6)}`;
    renderPicker();
    expect(screen.getByRole("checkbox", { name: /Svc 6/ })).toBeChecked();
  });
});
