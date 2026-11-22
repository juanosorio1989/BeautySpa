import { ApiError } from "@beautyspa/api-client";
import type { PlannedSegment, Slot } from "@beautyspa/contracts";
import { describe, expect, it, vi } from "vitest";
import { holdSlot, type HoldStore } from "./hold-slot";

const seg = (start: string): PlannedSegment => ({
  serviceId: "00000000-0000-4000-8000-000000000001",
  employeeId: "00000000-0000-4000-8000-000000000011",
  resourceId: null,
  startsAt: start,
  endsAt: "2026-11-19T17:00:00.000Z",
  blockEndsAt: "2026-11-19T17:00:00.000Z",
  durationMin: 30,
  priceCents: 2500,
});
const slotAt = (start: string): Slot => ({
  startsAt: start,
  endsAt: "2026-11-19T17:00:00.000Z",
  segments: [seg(start)],
});
const NOW = Date.parse("2026-11-19T15:00:00Z");
const MIN = 60_000;
const serverExpiry = "2026-11-19T15:05:00.000Z";
const opts = { now: NOW, holdMinutes: 5 };

function setup(hold: HoldStore["hold"]) {
  const api = {
    booking: {
      createHold: vi.fn().mockResolvedValue({ holdId: "new-hold", expiresAt: serverExpiry }),
      releaseHold: vi.fn().mockResolvedValue(undefined),
    },
  };
  const store: HoldStore = { hold, setHold: vi.fn(), clearHold: vi.fn() };
  return { api, store };
}

describe("holdSlot", () => {
  it("always creates a new hold, releasing and clearing a still-valid old one first", async () => {
    const slot = slotAt("2026-11-19T16:00:00.000Z");
    const { api, store } = setup({ holdId: "old", expiresAt: serverExpiry, localExpiresAt: NOW + 4 * MIN });
    expect(await holdSlot(api, store, slot, { ...opts, locationId: "loc" })).toBe("held");
    expect(api.booking.releaseHold).toHaveBeenCalledWith("old");
    expect(store.clearHold).toHaveBeenCalledTimes(1);
    expect(api.booking.createHold).toHaveBeenCalledWith({ locationId: "loc", segments: slot.segments });
    expect(store.setHold).toHaveBeenCalledWith({
      holdId: "new-hold",
      expiresAt: serverExpiry,
      localExpiresAt: NOW + 5 * MIN,
    });
  });

  it("measures the local deadline from the device clock and holdMinutes, not the server expiresAt", async () => {
    // The device clock runs 10 minutes fast: the server's expiresAt is 5 minutes in the device's past.
    const fastNow = Date.parse(serverExpiry) + 5 * MIN;
    const { api, store } = setup(null);
    await holdSlot(api, store, slotAt("2026-11-19T16:00:00.000Z"), { now: fastNow, holdMinutes: 5 });
    expect(store.setHold).toHaveBeenCalledWith(expect.objectContaining({ localExpiresAt: fastNow + 5 * MIN }));
  });

  it("does not release a locally expired hold but still clears it; release errors are ignored", async () => {
    const slot = slotAt("2026-11-19T16:00:00.000Z");
    const expired = setup({ holdId: "e", expiresAt: serverExpiry, localExpiresAt: NOW - 1 });
    await holdSlot(expired.api, expired.store, slot, opts);
    expect(expired.api.booking.releaseHold).not.toHaveBeenCalled();
    expect(expired.store.clearHold).toHaveBeenCalledTimes(1);
    expect(expired.api.booking.createHold).toHaveBeenCalled();

    const failing = setup({ holdId: "old", expiresAt: serverExpiry, localExpiresAt: NOW + MIN });
    failing.api.booking.releaseHold.mockRejectedValue(new Error("boom"));
    expect(await holdSlot(failing.api, failing.store, slot, opts)).toBe("held");
    expect(failing.store.clearHold).toHaveBeenCalledTimes(1);
  });

  it("leaves no old hold behind when the new hold fails", async () => {
    const { api, store } = setup({ holdId: "old", expiresAt: serverExpiry, localExpiresAt: NOW + MIN });
    api.booking.createHold.mockRejectedValue(
      new ApiError(409, { type: "about:blank", title: "x", status: 409, code: "SLOT_TAKEN" }),
    );
    expect(await holdSlot(api, store, slotAt("2026-11-19T16:00:00.000Z"), opts)).toBe("taken");
    expect(store.clearHold).toHaveBeenCalledTimes(1);
    expect(store.setHold).not.toHaveBeenCalled();
  });

  it("maps SLOT_TAKEN to taken and other failures to error", async () => {
    const slot = slotAt("2026-11-19T16:00:00.000Z");
    const taken = setup(null);
    taken.api.booking.createHold.mockRejectedValue(
      new ApiError(409, { type: "about:blank", title: "x", status: 409, code: "SLOT_TAKEN" }),
    );
    expect(await holdSlot(taken.api, taken.store, slot, opts)).toBe("taken");

    const err = new ApiError(429, { type: "about:blank", title: "x", status: 429, code: "RATE_LIMITED" });
    const other = setup(null);
    other.api.booking.createHold.mockRejectedValue(err);
    const onError = vi.fn();
    expect(await holdSlot(other.api, other.store, slot, { ...opts, onError })).toBe("error");
    expect(onError).toHaveBeenCalledWith(err);
  });
});
