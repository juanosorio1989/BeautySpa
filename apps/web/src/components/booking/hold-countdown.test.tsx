import { act, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { en } from "@beautyspa/i18n";
import { HoldCountdown } from "./hold-countdown";

const NOW = Date.parse("2026-11-19T15:00:00.000Z");

const mount = (localExpiresAt: number, onExpire = vi.fn()) => {
  render(
    <NextIntlClientProvider locale="en" messages={en}>
      <HoldCountdown localExpiresAt={localExpiresAt} onExpire={onExpire} />
    </NextIntlClientProvider>,
  );
  return onExpire;
};

describe("HoldCountdown", () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: NOW });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows m:ss from the local deadline and returns to time at 0 (expired callback)", () => {
    const onExpire = mount(NOW + 272_000);
    expect(screen.getByText("We're holding your time for 4:32")).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(2_000);
    });
    expect(screen.getByText("We're holding your time for 4:30")).toBeInTheDocument();
    expect(onExpire).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(270_000);
    });
    expect(onExpire).toHaveBeenCalledTimes(1);
  });

  it("calls onExpire right away for a hold that already expired", () => {
    const onExpire = mount(NOW - 1_000);
    expect(onExpire).toHaveBeenCalledTimes(1);
  });
});
