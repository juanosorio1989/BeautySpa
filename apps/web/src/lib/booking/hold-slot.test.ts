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
const future = "2026-11-19T15:05:00.000Z";
const past = "2026-11-19T14:59:00.000Z";

function setup(hold: HoldStore["hold"]) {
  const api = {
    booking: {
      createHold: vi.fn().mockResolvedValue({ holdId: "new-hold", expiresAt: future }),
      releaseHold: vi.fn().mockResolvedValue(undefined),
    },
  };
  const store: HoldStore = { hold, setHold: vi.fn() };
  return { api, store };
}

describe("holdSlot", () => {
  it("reuses a valid identical hold without calling the API", async () => {
    const slot = slotAt("2026-11-19T16:00:00.000Z");
    const { api, store } = setup({ holdId: "h1", expiresAt: future, segments: slot.segments });
    expect(await holdSlot(api, store, slot, { now: NOW })).toBe("held");
    expect(api.booking.createHold).not.toHaveBeenCalled();
    expect(api.booking.releaseHold).not.toHaveBeenCalled();
  });

  it("releases a different valid hold before creating", async () => {
    const slot = slotAt("2026-11-19T16:00:00.000Z");
    const { api, store } = setup({
      holdId: "old",
      expiresAt: future,
      segments: slotAt("2026-11-19T16:15:00.000Z").segments,
    });
    expect(await holdSlot(api, store, slot, { now: NOW, locationId: "loc" })).toBe("held");
    expect(api.booking.releaseHold).toHaveBeenCalledWith("old");
    expect(api.booking.createHold).toHaveBeenCalledWith({ locationId: "loc", segments: slot.segments });
    expect(store.setHold).toHaveBeenCalledWith({ holdId: "new-hold", expiresAt: future, segments: slot.segments });
  });

  it("does not release an expired hold and ignores release errors", async () => {
    const slot = slotAt("2026-11-19T16:00:00.000Z");
    const expired = setup({ holdId: "e", expiresAt: past, segments: slot.segments });
    await holdSlot(expired.api, expired.store, slot, { now: NOW });
    expect(expired.api.booking.releaseHold).not.toHaveBeenCalled();
    expect(expired.api.booking.createHold).toHaveBeenCalled();

    const failing = setup({ holdId: "old", expiresAt: future, segments: slotAt("2026-11-19T16:15:00.000Z").segments });
    failing.api.booking.releaseHold.mockRejectedValue(new Error("boom"));
    expect(await holdSlot(failing.api, failing.store, slot, { now: NOW })).toBe("held");
  });

  it("maps SLOT_TAKEN to taken and other failures to error", async () => {
    const slot = slotAt("2026-11-19T16:00:00.000Z");
    const taken = setup(null);
    taken.api.booking.createHold.mockRejectedValue(
      new ApiError(409, { type: "about:blank", title: "x", status: 409, code: "SLOT_TAKEN" }),
    );
    expect(await holdSlot(taken.api, taken.store, slot, { now: NOW })).toBe("taken");

    const err = new ApiError(429, { type: "about:blank", title: "x", status: 429, code: "RATE_LIMITED" });
    const other = setup(null);
    other.api.booking.createHold.mockRejectedValue(err);
    const onError = vi.fn();
    expect(await holdSlot(other.api, other.store, slot, { now: NOW, onError })).toBe("error");
    expect(onError).toHaveBeenCalledWith(err);
  });
});
