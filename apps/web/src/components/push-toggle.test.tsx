import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { en } from "@beautyspa/i18n";

const getPushSupport = vi.fn();
const enablePush = vi.fn();
const disablePush = vi.fn();
vi.mock("@/lib/push", () => ({
  getPushSupport: (...a: unknown[]) => getPushSupport(...a),
  enablePush: (...a: unknown[]) => enablePush(...a),
  disablePush: (...a: unknown[]) => disablePush(...a),
}));
vi.mock("@/lib/api/browser", () => ({ getBrowserApi: () => ({ push: {} }) }));

import { PushToggle } from "./push-toggle";

const mount = () =>
  render(
    <NextIntlClientProvider locale="en" messages={en}>
      <PushToggle consentSource="BOOKING_FORM" />
    </NextIntlClientProvider>,
  );

describe("PushToggle", () => {
  beforeEach(() => {
    getPushSupport.mockReset();
    enablePush.mockReset();
    disablePush.mockReset();
  });

  it("renders nothing when unsupported", async () => {
    getPushSupport.mockResolvedValue("unsupported");
    const { container } = mount();
    await waitFor(() => expect(getPushSupport).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the install hint on needs-install", async () => {
    getPushSupport.mockResolvedValue("needs-install");
    mount();
    expect(await screen.findByText(/Add to Home Screen/)).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("shows help text when denied", async () => {
    getPushSupport.mockResolvedValue("denied");
    mount();
    expect(await screen.findByText(/blocked for this site/)).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("enables with the consent source, then offers to turn off", async () => {
    getPushSupport.mockResolvedValue("available");
    enablePush.mockResolvedValue("subscribed");
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Notify me on this device" }));
    expect(await screen.findByRole("button", { name: "Turn off notifications on this device" })).toBeInTheDocument();
    expect(enablePush).toHaveBeenCalledWith(expect.anything(), "BOOKING_FORM");
  });

  it("switches to the help text when enabling ends denied", async () => {
    getPushSupport.mockResolvedValue("available");
    enablePush.mockResolvedValue("denied");
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Notify me on this device" }));
    expect(await screen.findByRole("status")).toHaveTextContent(/blocked for this site/);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("turns off when subscribed", async () => {
    getPushSupport.mockResolvedValue("subscribed");
    disablePush.mockResolvedValue(undefined);
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Turn off notifications on this device" }));
    expect(await screen.findByRole("button", { name: "Notify me on this device" })).toBeInTheDocument();
    expect(disablePush).toHaveBeenCalled();
  });

  it("shows an error when enabling fails", async () => {
    getPushSupport.mockResolvedValue("available");
    enablePush.mockRejectedValue(new Error("x"));
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Notify me on this device" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/could not change notifications/);
  });
});
