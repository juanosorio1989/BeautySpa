import { beforeEach, describe, expect, it } from "vitest";
import { createBookingStore } from "./store";

const sid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

describe("booking store", () => {
  beforeEach(() => sessionStorage.clear());

  it("toggleService refuses a fifth service", () => {
    const store = createBookingStore(() => sessionStorage);
    for (let n = 1; n <= 4; n++) expect(store.toggleService(sid(n))).toBe("ok");
    expect(store.toggleService(sid(5))).toBe("limit");
    expect(store.getState().serviceIds).toHaveLength(4);
    expect(store.toggleService(sid(2))).toBe("ok");
    expect(store.getState().serviceIds).toEqual([sid(1), sid(3), sid(4)]);
    expect(store.getState().choices.map((c) => c.serviceId)).toEqual([sid(1), sid(3), sid(4)]);
  });

  it("persists and restores from sessionStorage under bs-booking", () => {
    const a = createBookingStore(() => sessionStorage);
    a.toggleService(sid(1));
    a.setChoice(sid(1), sid(11));
    a.setDate("2026-11-19");
    expect(sessionStorage.getItem("bs-booking")).not.toBeNull();
    const b = createBookingStore(() => sessionStorage);
    expect(b.getState().serviceIds).toEqual([sid(1)]);
    expect(b.getState().choices).toEqual([{ serviceId: sid(1), employeeId: sid(11) }]);
    expect(b.getState().date).toBe("2026-11-19");
  });

  it("works when sessionStorage throws, and ignores corrupt data", () => {
    const broken = () => {
      throw new Error("denied");
    };
    const store = createBookingStore(broken);
    expect(store.toggleService(sid(1))).toBe("ok");
    expect(store.getState().serviceIds).toEqual([sid(1)]);

    sessionStorage.setItem("bs-booking", "{not json");
    expect(createBookingStore(() => sessionStorage).getState().serviceIds).toEqual([]);
  });

  it("clears the slot when choices or date change, and resets", () => {
    const store = createBookingStore(() => sessionStorage);
    store.toggleService(sid(1));
    const slot = { startsAt: "a", endsAt: "b", segments: [] };
    store.setSlot(slot as never);
    store.setDate("2026-11-20");
    expect(store.getState().slot).toBeNull();
    store.setSlot(slot as never);
    store.setChoice(sid(1), "ANY");
    expect(store.getState().slot).toBeNull();
    store.setHold({ holdId: "h", expiresAt: "x", segments: [] });
    store.clearHold();
    expect(store.getState().hold).toBeNull();
    store.reset();
    expect(store.getState().serviceIds).toEqual([]);
  });

  it("prefill replaces the selection", () => {
    const store = createBookingStore(() => sessionStorage);
    store.toggleService(sid(9));
    store.prefill([
      { serviceId: sid(1), employeeId: sid(11) },
      { serviceId: sid(2), employeeId: "ANY" },
    ]);
    expect(store.getState().serviceIds).toEqual([sid(1), sid(2)]);
    expect(store.getState().choices[0]!.employeeId).toBe(sid(11));
  });
});
