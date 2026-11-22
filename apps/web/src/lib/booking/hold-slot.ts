import { ApiError, type ApiClient } from "@beautyspa/api-client";
import type { Hold, PlannedSegment, Slot } from "@beautyspa/contracts";

/** The hold plus the segments it was made for, so a later pick of the same slot can reuse it. */
export type StoredHold = Hold & { segments: PlannedSegment[] };

export interface HoldStore {
  hold: StoredHold | null;
  setHold(hold: StoredHold): void;
}

const SEGMENT_KEYS = ["serviceId", "employeeId", "resourceId", "startsAt", "endsAt", "blockEndsAt"] as const;

function sameSegments(a: PlannedSegment[], b: PlannedSegment[]): boolean {
  return a.length === b.length && a.every((seg, i) => SEGMENT_KEYS.every((k) => seg[k] === b[i]![k]));
}

/**
 * Holds `slot`. Reuses a still-valid identical hold; otherwise releases a different valid hold
 * (best effort, it would expire anyway) and creates a new one. `onError` receives non-SLOT_TAKEN failures.
 */
export async function holdSlot(
  api: { booking: Pick<ApiClient["booking"], "createHold" | "releaseHold"> },
  store: HoldStore,
  slot: Slot,
  opts: { locationId?: string; now?: number; onError?: (err: unknown) => void } = {},
): Promise<"held" | "taken" | "error"> {
  const now = opts.now ?? Date.now();
  const current = store.hold;
  if (current && Date.parse(current.expiresAt) > now) {
    if (sameSegments(current.segments, slot.segments)) return "held";
    try {
      await api.booking.releaseHold(current.holdId);
    } catch {
      // best effort: the old hold expires by itself
    }
  }
  try {
    const hold = await api.booking.createHold({ locationId: opts.locationId, segments: slot.segments });
    store.setHold({ ...hold, segments: slot.segments });
    return "held";
  } catch (err) {
    if (err instanceof ApiError && err.problem.code === "SLOT_TAKEN") return "taken";
    opts.onError?.(err);
    return "error";
  }
}
