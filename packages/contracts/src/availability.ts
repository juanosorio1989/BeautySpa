import { z } from "zod";
import { IdSchema, IsoDateSchema, IsoInstantSchema, MoneyCentsSchema } from "./common";

export const PlannedSegmentSchema = z.object({
  serviceId: IdSchema,
  employeeId: IdSchema,
  resourceId: IdSchema.nullable(),
  startsAt: IsoInstantSchema,
  endsAt: IsoInstantSchema,
  blockEndsAt: IsoInstantSchema,
  durationMin: z.number().int().positive(),
  priceCents: MoneyCentsSchema,
});
export type PlannedSegment = z.infer<typeof PlannedSegmentSchema>;

export const SlotSchema = z.object({
  startsAt: IsoInstantSchema,
  endsAt: IsoInstantSchema,
  segments: z.array(PlannedSegmentSchema).min(1).max(4),
});
export type Slot = z.infer<typeof SlotSchema>;

export const ServiceChoiceSchema = z.object({
  serviceId: IdSchema,
  employeeId: z.union([IdSchema, z.literal("ANY")]),
});
export type ServiceChoice = z.infer<typeof ServiceChoiceSchema>;

export const AvailabilityQuerySchema = z.object({
  locationId: IdSchema.optional(),
  services: z.array(ServiceChoiceSchema).min(1).max(4),
  date: IsoDateSchema,
});
export type AvailabilityQuery = z.infer<typeof AvailabilityQuerySchema>;
