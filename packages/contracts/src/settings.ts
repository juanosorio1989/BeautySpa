import { z } from "zod";
import { DayHoursSchema, IdSchema, IsoInstantSchema, PhoneE164Schema, TimezoneSchema, WeekHoursSchema } from "./common";
import { refineInstantRange, refineQueryRange } from "./staff";

const nonEmpty = (o: object) => Object.keys(o).length > 0;
const EMPTY = "Empty update";

export const LocationSettingsSchema = z.object({
  slotIntervalMin: z.union([z.literal(5), z.literal(10), z.literal(15), z.literal(20), z.literal(30), z.literal(60)]),
  holdMinutes: z.number().int().min(1).max(30),
  cancelWindowHours: z.number().int().min(0).max(168),
  bookingHorizonDays: z.number().int().min(1).max(365),
  minLeadMinutes: z.number().int().min(0).max(1440),
});
export type LocationSettings = z.infer<typeof LocationSettingsSchema>;

export const DEFAULT_LOCATION_SETTINGS: LocationSettings = {
  slotIntervalMin: 15,
  holdMinutes: 5,
  cancelWindowHours: 24,
  bookingHorizonDays: 60,
  minLeadMinutes: 60,
};

export const StaffSettingsSchema = z.object({
  location: z.object({
    id: IdSchema,
    name: z.string(),
    address: z.string().nullable(),
    phone: PhoneE164Schema.nullable(),
    timezone: TimezoneSchema,
  }),
  settings: LocationSettingsSchema,
  hours: z.array(DayHoursSchema),
});
export type StaffSettings = z.infer<typeof StaffSettingsSchema>;

export const StaffSettingsPatchSchema = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    address: z.string().trim().max(200).nullable().optional(),
    phone: PhoneE164Schema.nullable().optional(),
    timezone: TimezoneSchema.optional(),
    settings: LocationSettingsSchema.partial().optional(),
    hours: WeekHoursSchema.optional(),
  })
  .refine(nonEmpty, EMPTY);
export type StaffSettingsPatch = z.infer<typeof StaffSettingsPatchSchema>;

export const LocationQuerySchema = z.object({ locationId: IdSchema.optional() });
export type LocationQuery = z.infer<typeof LocationQuerySchema>;

const ClosureFieldsSchema = z.object({
  locationId: IdSchema.optional(),
  startsAt: IsoInstantSchema,
  endsAt: IsoInstantSchema,
  reason: z.string().trim().max(200).nullable().default(null),
});

export const ClosureInputSchema = ClosureFieldsSchema.superRefine(refineInstantRange);
export type ClosureInput = z.infer<typeof ClosureInputSchema>;
export const ClosureUpdateSchema = ClosureFieldsSchema.pick({ startsAt: true, endsAt: true, reason: true })
  .partial()
  .refine(nonEmpty, EMPTY);
export type ClosureUpdate = z.infer<typeof ClosureUpdateSchema>;
export const ClosureSchema = z.object({
  id: IdSchema,
  locationId: IdSchema,
  startsAt: IsoInstantSchema,
  endsAt: IsoInstantSchema,
  reason: z.string().nullable(),
});
export type Closure = z.infer<typeof ClosureSchema>;

export const ClosureQuerySchema = z
  .object({ from: IsoInstantSchema, to: IsoInstantSchema, locationId: IdSchema.optional() })
  .superRefine(refineQueryRange);
export type ClosureQuery = z.infer<typeof ClosureQuerySchema>;
