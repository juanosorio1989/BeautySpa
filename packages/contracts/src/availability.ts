import { z } from "zod";
import { IdSchema, IsoDateSchema, IsoInstantSchema, MoneyCentsSchema, QueryBooleanSchema } from "./common";

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
  /** Only on `override=true` responses: true when the start is outside normal hours or in a closure. */
  outsideHours: z.boolean().optional(),
});
export type Slot = z.infer<typeof SlotSchema>;

export const ServiceChoiceSchema = z.object({
  serviceId: IdSchema,
  employeeId: z.union([IdSchema, z.literal("ANY")]),
});
export type ServiceChoice = z.infer<typeof ServiceChoiceSchema>;

const ServiceChoiceStringSchema = z.string().transform((value, ctx): ServiceChoice => {
  const [serviceId, employeeId, ...rest] = value.split(":");
  const parsed = ServiceChoiceSchema.safeParse({ serviceId, employeeId });
  if (rest.length > 0 || !parsed.success) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Expected serviceId:employeeId|ANY" });
    return z.NEVER;
  }
  return parsed.data;
});

export const ServiceChoiceInputSchema = z.union([ServiceChoiceSchema, ServiceChoiceStringSchema]);

export const AvailabilityQuerySchema = z.object({
  locationId: IdSchema.optional(),
  services: z.preprocess(
    (v) => (Array.isArray(v) || v === undefined ? v : [v]),
    z.array(ServiceChoiceInputSchema).min(1).max(4),
  ),
  date: IsoDateSchema,
  excludeAppointmentId: IdSchema.optional(),
  /** Staff only: also list times outside working hours and closures (flagged `outsideHours`). */
  override: QueryBooleanSchema.default("false"),
});
export type AvailabilityQuery = z.infer<typeof AvailabilityQuerySchema>;
