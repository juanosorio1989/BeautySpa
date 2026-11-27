import { z } from "zod";
import { StaffRoleSchema } from "./auth";
import { IdSchema, IsoInstantSchema, LocalizedTextSchema } from "./common";

/** `GET /staff/me`: the signed-in staff user (name = profile display name, else email). */
export const StaffMeSchema = z.object({ id: IdSchema, name: z.string(), email: z.string(), role: StaffRoleSchema });
export type StaffMe = z.infer<typeof StaffMeSchema>;

/** `GET /staff/booking-catalog`: everything quick booking needs, STAFF view (not only online-bookable). */
export const BookingCatalogSchema = z.object({
  categories: z.array(z.object({ id: IdSchema, name: LocalizedTextSchema })),
  services: z.array(
    z.object({
      id: IdSchema,
      categoryId: IdSchema.nullable(),
      name: LocalizedTextSchema,
      durationMin: z.number().int(),
      priceCents: z.number().int(),
      parallelizable: z.boolean(),
      onlineBookable: z.boolean(),
    }),
  ),
  employees: z.array(
    z.object({
      id: IdSchema,
      displayName: z.string(),
      levelId: IdSchema.nullable(),
      serviceIds: z.array(IdSchema),
    }),
  ),
  popularServiceIds: z.array(IdSchema).max(6),
});
export type BookingCatalog = z.infer<typeof BookingCatalogSchema>;

/**
 * `GET`/`PUT /staff/customers/:id/notes`: staff-only private notes (OWNER, RECEPTION).
 * `updatedAt`/`updatedBy` are null until the first write; `updatedBy` is null when the author was deleted.
 */
export const CustomerNotesSchema = z.object({
  notes: z.string().nullable(),
  updatedAt: IsoInstantSchema.nullable(),
  updatedBy: z.object({ id: IdSchema, name: z.string() }).nullable(),
});
export type CustomerNotes = z.infer<typeof CustomerNotesSchema>;

/** `PUT /staff/customers/:id/notes` body: trimmed, at most 2,000 characters; blank or null clears the notes. */
export const CustomerNotesInputSchema = z.object({
  notes: z
    .string()
    .trim()
    .max(2000)
    .nullable()
    .transform((v) => (v === "" ? null : v)),
});
export type CustomerNotesInput = z.infer<typeof CustomerNotesInputSchema>;
