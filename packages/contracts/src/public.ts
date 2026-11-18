import { z } from "zod";
import { CategorySchema, LevelSchema } from "./catalog";
import { DayHoursSchema, IdSchema, LocalizedTextSchema, MoneyCentsSchema, PhoneE164Schema, TimezoneSchema } from "./common";

export const PublicLocationSchema = z.object({
  id: IdSchema,
  name: z.string(),
  address: z.string().nullable(),
  phone: PhoneE164Schema.nullable(),
  timezone: TimezoneSchema,
  hours: z.array(DayHoursSchema),
});
export type PublicLocation = z.infer<typeof PublicLocationSchema>;

export const PublicServiceSchema = z.object({
  id: IdSchema,
  categoryId: IdSchema.nullable(),
  name: LocalizedTextSchema,
  description: LocalizedTextSchema.nullable(),
  durationMin: z.number().int(),
  priceCents: MoneyCentsSchema,
  fromPriceCents: MoneyCentsSchema,
  parallelizable: z.boolean(),
});
export type PublicService = z.infer<typeof PublicServiceSchema>;

export const PublicServicesResponseSchema = z.object({
  categories: z.array(CategorySchema),
  services: z.array(PublicServiceSchema),
});
export type PublicServicesResponse = z.infer<typeof PublicServicesResponseSchema>;

export const PublicEmployeeSchema = z.object({
  id: IdSchema,
  displayName: z.string(),
  bio: LocalizedTextSchema.nullable(),
  photoUrl: z.string().nullable(),
  level: LevelSchema.nullable(),
  serviceIds: z.array(IdSchema),
});
export type PublicEmployee = z.infer<typeof PublicEmployeeSchema>;
