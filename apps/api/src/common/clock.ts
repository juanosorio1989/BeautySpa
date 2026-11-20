/** Injection token for the `Clock` (provided by the global `CommonModule`). */
export const CLOCK = Symbol("CLOCK");

/** The current time in epoch ms. Booking code reads time only through this, so tests can pin it. */
export interface Clock {
  now(): number;
}

export const systemClock: Clock = { now: () => Date.now() };
