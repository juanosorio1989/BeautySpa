import { ApiError } from "@beautyspa/api-client";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { en } from "@beautyspa/i18n";
import { id, me } from "@/components/booking/test-fixtures";
import { bookingStore } from "@/lib/booking/store";

const replace = vi.fn();
vi.mock("@/i18n/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace }),
  usePathname: () => "/me/profile",
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
const routerReplace = vi.fn();
vi.mock("next/navigation", () => ({
  useParams: () => ({ locale: "en" }),
  useRouter: () => ({ push: vi.fn(), replace: routerReplace }),
}));
vi.mock("next-intl", async (orig) => ({ ...(await orig<typeof import("next-intl")>()), useLocale: () => "en" }));

const api = {
  auth: { refresh: vi.fn(), logout: vi.fn() },
  me: { get: vi.fn(), patch: vi.fn(), export: vi.fn(), remove: vi.fn() },
};
vi.mock("@/lib/api/browser", () => ({ getBrowserApi: () => api, setSessionExpiredHandler: vi.fn() }));

import { SessionProvider } from "@/lib/session/session-provider";
import { useSession } from "@/lib/session/use-session";
import ProfilePage from "./page";

const problem = (status: number, code: string, errors?: { path: string; message: string }[]) =>
  new ApiError(status, { type: "about:blank", title: "x", status, code, errors } as never);

function StatusProbe() {
  return <output data-testid="session-status">{useSession().status}</output>;
}

const mount = () =>
  render(
    <NextIntlClientProvider locale="en" messages={en}>
      <SessionProvider>
        <ProfilePage />
        <StatusProbe />
      </SessionProvider>
    </NextIntlClientProvider>,
  );

const saved = (over = {}) => me({ name: "Maria", email: "m@x.co", ...over });

describe("/me/profile", () => {
  beforeEach(() => {
    for (const group of Object.values(api)) for (const fn of Object.values(group)) fn.mockReset();
    replace.mockReset();
    routerReplace.mockReset();
    bookingStore.reset();
    api.auth.refresh.mockResolvedValue({});
    api.auth.logout.mockResolvedValue(undefined);
    api.me.get.mockResolvedValue(saved());
  });
  afterEach(() => vi.unstubAllGlobals());

  it("signed-out visit redirects to login with next", async () => {
    api.auth.refresh.mockRejectedValue(problem(401, "UNAUTHORIZED"));
    mount();
    await waitFor(() =>
      expect(routerReplace).toHaveBeenCalledWith(`/en/login?next=${encodeURIComponent("/en/me/profile")}`),
    );
  });

  it("saves only the changed fields", async () => {
    api.me.patch.mockResolvedValue(saved({ name: "Maria Lopez" }));
    mount();
    fireEvent.change(await screen.findByLabelText("Your name"), { target: { value: "Maria Lopez" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(api.me.patch).toHaveBeenCalledWith({ name: "Maria Lopez" }));
    expect(await screen.findByText("Your changes were saved.")).toBeInTheDocument();
  });

  it("the email consent switch sends consents with no consentSource (API default PROFILE)", async () => {
    api.me.patch.mockResolvedValue(saved({ consents: { WHATSAPP: false, SMS: false, EMAIL: true } }));
    mount();
    fireEvent.click(await screen.findByRole("switch", { name: "Email me my confirmation and reminders" }));
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(api.me.patch).toHaveBeenCalledTimes(1));
    const body = api.me.patch.mock.calls[0]![0] as Record<string, unknown>;
    expect(body).toEqual({ consents: { EMAIL: true } });
    expect("consentSource" in body).toBe(false);
  });

  it("the consent switch is disabled without an email", async () => {
    api.me.get.mockResolvedValue(me({ name: "Maria" }));
    mount();
    expect(await screen.findByRole("switch", { name: "Email me my confirmation and reminders" })).toBeDisabled();
  });

  it("saving with nothing changed does not call the API", async () => {
    mount();
    await screen.findByLabelText("Your name");
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(await screen.findByText("No changes to save.")).toBeInTheDocument();
    expect(api.me.patch).not.toHaveBeenCalled();
  });

  it("changing language patches locale and switches the URL locale", async () => {
    api.me.patch.mockResolvedValue(saved({ locale: "es" }));
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Spanish" }));
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(api.me.patch).toHaveBeenCalledWith({ locale: "es" }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/me/profile", { locale: "es" }));
  });

  it("stored es + URL en: pick Spanish sends no locale and switches the URL", async () => {
    api.me.get.mockResolvedValue(saved({ locale: "es" }));
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Spanish" }));
    expect(screen.getByRole("button", { name: "Spanish" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/me/profile", { locale: "es" }));
    expect(api.me.patch).not.toHaveBeenCalled();
  });

  it("editing only the name with stored es on /en sends no locale and keeps the page language", async () => {
    api.me.get.mockResolvedValue(saved({ locale: "es" }));
    api.me.patch.mockResolvedValue(saved({ locale: "es", name: "Ana" }));
    mount();
    fireEvent.change(await screen.findByLabelText("Your name"), { target: { value: "Ana" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(api.me.patch).toHaveBeenCalledWith({ name: "Ana" }));
    expect(await screen.findByText("Your changes were saved.")).toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();
  });

  it("clearing the email while consent is on sends consents.EMAIL false", async () => {
    api.me.get.mockResolvedValue(saved({ consents: { WHATSAPP: false, SMS: false, EMAIL: true } }));
    api.me.patch.mockResolvedValue(saved({ email: null }));
    mount();
    fireEvent.change(await screen.findByLabelText("Email"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(api.me.patch).toHaveBeenCalledWith({ email: null, consents: { EMAIL: false } }));
  });

  it("a session error shows the network copy and retry loads the profile", async () => {
    api.auth.refresh.mockRejectedValueOnce(new TypeError("offline"));
    mount();
    expect(await screen.findByRole("alert")).toHaveTextContent("We could not reach the server");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByLabelText("Your name")).toBeInTheDocument();
  });

  it("delete moves focus to the confirm heading and back to the trigger on keep", async () => {
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Delete my account" }));
    expect(screen.getByRole("heading", { name: "Delete your account?" })).toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: "Keep my account" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Delete my account" })).toHaveFocus());
  });

  it("a name validation error shows localized copy under the field, not the API message", async () => {
    api.me.patch.mockRejectedValue(problem(400, "VALIDATION_FAILED", [{ path: "name", message: "RAW" }]));
    mount();
    fireEvent.change(await screen.findByLabelText("Your name"), { target: { value: "X" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(await screen.findByText("Please enter a valid name.")).toBeInTheDocument();
    expect(screen.queryByText("RAW")).not.toBeInTheDocument();
    const input = screen.getByLabelText("Your name");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAccessibleDescription("Please enter a valid name.");
    expect(screen.getByLabelText("Email")).toHaveAttribute("aria-invalid", "false");
  });

  it("a validation error for an unrendered field falls back to the generic copy", async () => {
    api.me.patch.mockRejectedValue(problem(400, "VALIDATION_FAILED", [{ path: "locale", message: "RAW" }]));
    mount();
    fireEvent.change(await screen.findByLabelText("Your name"), { target: { value: "Y" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Something went wrong. Please try again.");
  });

  it("download my data saves the export JSON as a file", async () => {
    const exported = { customer: saved(), consentHistory: [], appointments: [] };
    api.me.export.mockResolvedValue(exported);
    const create = vi.fn(() => "blob:test");
    const revoke = vi.fn();
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke }));
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Download my data" }));
    await waitFor(() => expect(click).toHaveBeenCalled());
    const blob = (create.mock.calls[0] as unknown as [Blob])[0];
    const text = await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.readAsText(blob);
    });
    expect(JSON.parse(text)).toEqual(exported);
    expect(click.mock.contexts[0]).toMatchObject({ download: "beautyspa-my-data.json", href: "blob:test" });
    await waitFor(() => expect(revoke).toHaveBeenCalledWith("blob:test"));
    click.mockRestore();
  });

  it("delete account needs a second explicit button, then calls me.remove, auth.logout and lands home with the notice", async () => {
    api.me.remove.mockResolvedValue(undefined);
    bookingStore.toggleService(id(1));
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Delete my account" }));
    expect(api.me.remove).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Yes, delete my account" }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/?deleted=1"));
    expect(api.me.remove.mock.invocationCallOrder[0]!).toBeLessThan(api.auth.logout.mock.invocationCallOrder[0]!);
    expect(bookingStore.getState().serviceIds).toEqual([]);
  });

  it("delete account still ends signed out locally when logout fails afterwards", async () => {
    api.me.remove.mockResolvedValue(undefined);
    api.auth.logout.mockRejectedValue(new TypeError("offline"));
    bookingStore.toggleService(id(1));
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Delete my account" }));
    expect(screen.getByTestId("session-status")).toHaveTextContent("signedIn");
    fireEvent.click(screen.getByRole("button", { name: "Yes, delete my account" }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/?deleted=1"));
    expect(screen.getByTestId("session-status")).toHaveTextContent("signedOut");
    expect(bookingStore.getState().serviceIds).toEqual([]);
  });

  it("a failed delete keeps the account and shows the error", async () => {
    api.me.remove.mockRejectedValue(problem(500, "INTERNAL"));
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Delete my account" }));
    fireEvent.click(screen.getByRole("button", { name: "Yes, delete my account" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Something went wrong");
    expect(api.auth.logout).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
  });
});
