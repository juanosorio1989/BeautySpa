import { ApiError } from "@beautyspa/api-client";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { en } from "@beautyspa/i18n";
import { appointment, emp, id, location, me, svc } from "@/components/booking/test-fixtures";

const replace = vi.fn();
vi.mock("@/i18n/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace }),
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
const routerReplace = vi.fn();
vi.mock("next/navigation", () => ({
  useParams: () => ({ locale: "en", appointmentId: id(400) }),
  useRouter: () => ({ push: vi.fn(), replace: routerReplace }),
}));

const api = {
  auth: { refresh: vi.fn(), logout: vi.fn() },
  public: { locations: vi.fn(), services: vi.fn(), employees: vi.fn() },
  me: { get: vi.fn(), appointments: vi.fn(), patch: vi.fn() },
};
vi.mock("@/lib/api/browser", () => ({ getBrowserApi: () => api, setSessionExpiredHandler: vi.fn() }));

import { SessionProvider } from "@/lib/session/session-provider";
import DonePage from "./page";

const mount = () =>
  render(
    <NextIntlClientProvider locale="en" messages={en}>
      <SessionProvider>
        <DonePage />
      </SessionProvider>
    </NextIntlClientProvider>,
  );

describe("/book/done/:appointmentId", () => {
  beforeEach(() => {
    for (const group of Object.values(api)) for (const fn of Object.values(group)) fn.mockReset();
    routerReplace.mockReset();
    api.auth.refresh.mockResolvedValue({});
    api.public.locations.mockResolvedValue([{ ...location, address: "12 Main St" }]);
    api.public.services.mockResolvedValue({ categories: [], services: [svc(1), svc(2)] });
    api.public.employees.mockResolvedValue([emp(11, [id(1)]), emp(12, [id(2)])]);
    api.me.get.mockResolvedValue(me({ name: "Maria" }));
    api.me.appointments.mockResolvedValue({ upcoming: [appointment()], past: [] });
  });

  it("loads the appointment from me.appointments and shows the email offer only without EMAIL consent", async () => {
    mount();
    expect(await screen.findByRole("heading", { name: "You're all set, Maria!" })).toBeInTheDocument();
    expect(screen.getByText("Svc 1 · Emp 11")).toBeInTheDocument();
    expect(screen.getByText("12 Main St")).toBeInTheDocument();
    expect(screen.getByText("Want your confirmation and reminders by email?")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "See or change my appointments" })).toHaveAttribute("href", "/me");
    expect(screen.getByRole("link", { name: "Book another" })).toHaveAttribute("href", "/");
  });

  it("hides the email offer when EMAIL consent exists", async () => {
    api.me.get.mockResolvedValue(me({ name: "Maria", consents: { WHATSAPP: false, SMS: false, EMAIL: true } }));
    mount();
    await screen.findByRole("heading", { name: "You're all set, Maria!" });
    expect(screen.queryByText("Want your confirmation and reminders by email?")).not.toBeInTheDocument();
  });

  it("the offer hides after saving", async () => {
    api.me.patch.mockResolvedValue(me({ name: "Maria", consents: { WHATSAPP: false, SMS: false, EMAIL: true } }));
    mount();
    fireEvent.change(await screen.findByLabelText("Email"), { target: { value: "m@x.co" } });
    fireEvent.click(screen.getByRole("button", { name: "Yes, email me" }));
    await waitFor(() =>
      expect(screen.queryByText("Want your confirmation and reminders by email?")).not.toBeInTheDocument(),
    );
  });

  it("an appointment that is not the customer's shows the not-found message", async () => {
    api.me.appointments.mockResolvedValue({ upcoming: [], past: [] });
    mount();
    expect(await screen.findByRole("alert")).toHaveTextContent("We could not find that.");
  });

  it("an appointment whose location is not public uses the failure path", async () => {
    api.me.appointments.mockResolvedValue({ upcoming: [appointment({ locationId: id(999) })], past: [] });
    mount();
    expect(await screen.findByRole("alert")).toHaveTextContent("Something went wrong");
  });

  it("signed-out visitors go to login with next", async () => {
    api.auth.refresh.mockRejectedValue(
      new ApiError(401, { type: "about:blank", title: "x", status: 401, code: "UNAUTHORIZED" }),
    );
    mount();
    await waitFor(() =>
      expect(routerReplace).toHaveBeenCalledWith(`/en/login?next=${encodeURIComponent(`/en/book/done/${id(400)}`)}`),
    );
  });
});
