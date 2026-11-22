"use client";

import { useSyncExternalStore } from "react";
import type { ServiceChoice, Slot } from "@beautyspa/contracts";
import { BOOKING_STORE_KEY } from "@/lib/session/session-provider";
import type { StoredHold } from "./hold-slot";

export const MAX_SERVICES = 4;

export interface BookingState {
  serviceIds: string[];
  choices: ServiceChoice[];
  date: string | null;
  slot: Slot | null;
  hold: StoredHold | null;
}

const EMPTY: BookingState = { serviceIds: [], choices: [], date: null, slot: null, hold: null };

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
      hold: v.hold ?? null,
    };
  } catch {
    return EMPTY;
  }
}

/** A small external store persisted to sessionStorage; `getStorage` may throw (private mode, blocked). */
export function createBookingStore(getStorage: () => Storage) {
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

  return {
    getState: load,
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    toggleService(id: string): "ok" | "limit" {
      const s = load();
      if (s.serviceIds.includes(id)) {
        update({
          serviceIds: s.serviceIds.filter((x) => x !== id),
          choices: s.choices.filter((c) => c.serviceId !== id),
          slot: null,
        });
        return "ok";
      }
      if (s.serviceIds.length >= MAX_SERVICES) return "limit";
      update({
        serviceIds: [...s.serviceIds, id],
        choices: [...s.choices, { serviceId: id, employeeId: "ANY" }],
        slot: null,
      });
      return "ok";
    },
    setChoice(serviceId: string, employeeId: string | "ANY"): void {
      update({
        choices: load().choices.map((c) => (c.serviceId === serviceId ? { ...c, employeeId } : c)),
        slot: null,
      });
    },
    setDate: (date: string | null): void => update({ date, slot: null }),
    setSlot: (slot: Slot | null): void => update({ slot }),
    setHold: (hold: StoredHold): void => update({ hold }),
    clearHold: (): void => update({ hold: null }),
    prefill(services: ServiceChoice[]): void {
      update({
        serviceIds: services.map((s) => s.serviceId),
        choices: services,
        date: null,
        slot: null,
      });
    },
    reset: (): void => set(EMPTY),
  };
}

export const bookingStore = createBookingStore(() => sessionStorage);

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
