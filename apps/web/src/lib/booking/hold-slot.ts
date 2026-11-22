import { ApiError, type ApiClient } from "@beautyspa/api-client";
import type { Hold, Slot } from "@beautyspa/contracts";

/**
 * The hold plus `localExpiresAt` (epoch ms on the device clock): device receipt time plus the
 * location's hold length. The countdown and every "still valid" check use it, never the server's
 * `expiresAt`, so a skewed device clock cannot expire a fresh hold. The API stays the decider.
 */
export type StoredHold = Hold & { localExpiresAt: number };

export interface HoldStore {
  hold: StoredHold | null;
  setHold(hold: StoredHold): void;
  clearHold(): void;
}

const MINUTE = 60_000;

/**
 * Holds `slot` with a new hold. A stored hold is dropped first: released (best effort, it would
 * expire anyway) while still locally valid, and cleared from the store either way, so a failed
 * create never leaves it looking valid. `onError` receives non-SLOT_TAKEN failures.
 */
export async function holdSlot(
  api: { booking: Pick<ApiClient["booking"], "createHold" | "releaseHold"> },
  store: HoldStore,
  slot: Slot,
  opts: { holdMinutes: number; locationId?: string; now?: number; onError?: (err: unknown) => void },
): Promise<"held" | "taken" | "error"> {
  const current = store.hold;
  if (current) {
    if (current.localExpiresAt > (opts.now ?? Date.now())) {
      try {
        await api.booking.releaseHold(current.holdId);
      } catch {
        // best effort: the old hold expires by itself
      }
    }
    store.clearHold();
  }
  try {
    const hold = await api.booking.createHold({ locationId: opts.locationId, segments: slot.segments });
    // Measured from receipt (after the request), so the local deadline never runs ahead of the server's.
    const receivedAt = opts.now ?? Date.now();
    store.setHold({ ...hold, localExpiresAt: receivedAt + opts.holdMinutes * MINUTE });
    return "held";
  } catch (err) {
    if (err instanceof ApiError && err.problem.code === "SLOT_TAKEN") return "taken";
    opts.onError?.(err);
    return "error";
  }
}
