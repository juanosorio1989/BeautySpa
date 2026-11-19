import { z } from "zod";
import { IsoInstantSchema, refineInstantRange } from "@beautyspa/contracts";
import { invalidRef } from "./http-errors.js";

const RangeSchema = z.object({ startsAt: IsoInstantSchema, endsAt: IsoInstantSchema }).superRefine(refineInstantRange);

/** Re-checks a merged `startsAt < endsAt` range after a PATCH; 400 on `endsAt` otherwise. */
export function assertInstantRange(range: { startsAt: string; endsAt: string }): void {
  const parsed = RangeSchema.safeParse(range);
  if (!parsed.success) throw invalidRef("endsAt", parsed.error.issues[0]?.message ?? "Invalid range");
}
