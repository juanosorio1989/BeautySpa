"use client";

import { useSyncExternalStore } from "react";
import type { ServiceChoice, Slot } from "@beautyspa/contracts";
import { getBrowserApi } from "@/lib/api/browser";
import type { StoredHold } from "./hold-slot";

export const BOOKING_STORE_KEY = "bs-booking";
export const MAX_SERVICES = 4;

export interface BookingState {
  serviceIds: string[];
  choices: ServiceChoice[];
  date: string | null;
  slot: Slot | null;
  hold: StoredHold | null;
}

const EMPTY: BookingState = { serviceIds: [], choices: [], date: null, slot: null, hold: null };

/** Holds stored before `localExpiresAt` existed are not trusted (their expiry was the server's clock). */
function storedHold(v: unknown): StoredHold | null {
  if (!v || typeof v !== "object") return null;
  const h = v as Partial<StoredHold>;
  return typeof h.holdId === "string" && typeof h.expiresAt === "string" && typeof h.localExpiresAt === "number"
    ? { holdId: h.holdId, expiresAt: h.expiresAt, localExpiresAt: h.localExpiresAt }
    : null;
}

function parse(raw: string | null): BookingState {
  if (!raw) return EMPTY;
  try {
    const v = JSON.parse(raw) as Partial<BookingState>;
    if (!Array.isArray(v.serviceIds) || !Array.isArray(v.choices)) return EMPTY;
    return {
      serviceIds: v.serviceIds,
      choices: v.choices,
      date: typeof v.date === "string" ? v.date : null,
      slot: v.slot ?? null,
      hold: storedHold(v.hold),
    };
  } catch {
    return EMPTY;
  }
}

/**
 * A small external store persisted to sessionStorage; `getStorage` may throw (private mode, blocked).
 * Changing the services or professionals (`toggleService`, `setChoice`, `prefill`) drops the hold,
 * which no longer matches them, and hands it to `onHoldDropped` for a best-effort release.
 */
export function createBookingStore(getStorage: () => Storage, onHoldDropped?: (hold: StoredHold) => void) {
  let state: BookingState | null = null;
  const listeners = new Set<() => void>();

  const load = (): BookingState => {
    if (state) return state;
    try {
      state = parse(getStorage().getItem(BOOKING_STORE_KEY));
    } catch {
      state = EMPTY;
    }
    return state;
  };
  const set = (next: BookingState): void => {
    state = next;
    try {
      getStorage().setItem(BOOKING_STORE_KEY, JSON.stringify(next));
    } catch {
      // storage unavailable: the in-memory state still works
    }
    listeners.forEach((l) => l());
  };
  const update = (patch: Partial<BookingState>): void => set({ ...load(), ...patch });
  /** `update` for a selection change: the hold goes too. */
  const changeSelection = (patch: Partial<BookingState>): void => {
    const dropped = load().hold;
    update({ ...patch, hold: null });
    if (dropped) onHoldDropped?.(dropped);
  };

  return {
    getState: load,
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    /** With `catalogIds`, stored ids missing from the current catalog do not count toward the limit. */
    toggleService(id: string, catalogIds?: readonly string[]): "ok" | "limit" {
      const s = load();
      if (s.serviceIds.includes(id)) {
        changeSelection({
          serviceIds: s.serviceIds.filter((x) => x !== id),
          choices: s.choices.filter((c) => c.serviceId !== id),
          slot: null,
        });
        return "ok";
      }
      const counted = catalogIds ? s.serviceIds.filter((x) => catalogIds.includes(x)) : s.serviceIds;
      if (counted.length >= MAX_SERVICES) return "limit";
      changeSelection({
        serviceIds: [...s.serviceIds, id],
        choices: [...s.choices, { serviceId: id, employeeId: "ANY" }],
        slot: null,
      });
      return "ok";
    },
    setChoice(serviceId: string, employeeId: string | "ANY"): void {
      changeSelection({
        choices: load().choices.map((c) => (c.serviceId === serviceId ? { ...c, employeeId } : c)),
        slot: null,
      });
    },
    setDate: (date: string | null): void => update({ date, slot: null }),
    setSlot: (slot: Slot | null): void => update({ slot }),
    setHold: (hold: StoredHold): void => update({ hold }),
    clearHold: (): void => update({ hold: null }),
    prefill(services: ServiceChoice[]): void {
      changeSelection({
        serviceIds: services.map((s) => s.serviceId),
        choices: services,
        date: null,
        slot: null,
      });
    },
    /** Clears memory and sessionStorage (booking done, logout, account deleted). */
    reset(): void {
      state = EMPTY;
      try {
        getStorage().removeItem(BOOKING_STORE_KEY);
      } catch {
        // storage unavailable: nothing to clear
      }
      listeners.forEach((l) => l());
    },
  };
}

export const bookingStore = createBookingStore(
  () => sessionStorage,
  (hold) => {
    // best effort: the hold expires by itself
    Promise.resolve()
      .then(() => getBrowserApi().booking.releaseHold(hold.holdId))
      .catch(() => undefined);
  },
);

type Snapshot = { state: BookingState; ready: boolean };
const SERVER_SNAPSHOT: Snapshot = { state: EMPTY, ready: false };
let snapshot: Snapshot | null = null;

function getSnapshot(): Snapshot {
  const state = bookingStore.getState();
  if (!snapshot || snapshot.state !== state) snapshot = { state, ready: true };
  return snapshot;
}

/** Booking state plus actions. `ready` is false during SSR/hydration (sessionStorage not read yet). */
export function useBookingStore() {
  const { state, ready } = useSyncExternalStore(bookingStore.subscribe, getSnapshot, () => SERVER_SNAPSHOT);
  return {
    ...state,
    ready,
    toggleService: bookingStore.toggleService,
    setChoice: bookingStore.setChoice,
    setDate: bookingStore.setDate,
    setSlot: bookingStore.setSlot,
    setHold: bookingStore.setHold,
    clearHold: bookingStore.clearHold,
    prefill: bookingStore.prefill,
    reset: bookingStore.reset,
  };
}
