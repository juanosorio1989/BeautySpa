import { render, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { en } from "@beautyspa/i18n";
import { bookingStore } from "@/lib/booking/store";
import { emp, id, location, svc } from "@/components/booking/test-fixtures";

const replace = vi.fn();
vi.mock("@/i18n/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace }),
  Link: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}));
vi.mock("next/navigation", () => ({ useParams: () => ({ locale: "en" }) }));

const api = {
  public: {
    locations: vi.fn(),
    services: vi.fn(),
    employees: vi.fn(),
  },
  booking: { availability: vi.fn().mockResolvedValue([]), createHold: vi.fn(), releaseHold: vi.fn() },
};
vi.mock("@/lib/api/browser", () => ({ getBrowserApi: () => api }));

import TimePage from "./page";

const mount = () =>
  render(
    <NextIntlClientProvider locale="en" messages={en}>
      <TimePage />
    </NextIntlClientProvider>,
  );

describe("/book/time", () => {
  beforeEach(() => {
    sessionStorage.clear();
    bookingStore.reset();
    replace.mockReset();
    api.public.locations.mockResolvedValue([location]);
    api.public.services.mockResolvedValue({ categories: [], services: [svc(1)] });
    api.public.employees.mockResolvedValue([emp(11, [id(1)])]);
  });

  it("/book/time without services redirects to step 1", async () => {
    mount();
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/"));
  });

  it("renders the picker when services are chosen", async () => {
    bookingStore.toggleService(id(1));
    const view = mount();
    await waitFor(() => expect(view.getByRole("heading", { name: "Professional and time" })).toBeInTheDocument());
    expect(replace).not.toHaveBeenCalled();
  });
});
