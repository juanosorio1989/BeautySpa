import { z } from "zod";
import { AppointmentSchema, CancelInputSchema } from "./booking";
import { TimezoneSchema } from "./common";

/**
 * What a manage link shows (`GET /manage/:token`): the customer-shaped appointment (a staff cancel reason
 * reads as `null`), its location (address on one line) and what the customer may still do.
 */
export const ManageViewSchema = z.object({
  appointment: AppointmentSchema,
  location: z.object({
    name: z.string(),
    addressLine: z.string(),
    phone: z.string().nullable(),
    timezone: TimezoneSchema,
  }),
  /** `BOOKED` and inside the location's cancel window. */
  canCancel: z.boolean(),
  /** `BOOKED` and not yet confirmed by the customer. */
  canConfirm: z.boolean(),
});
export type ManageView = z.infer<typeof ManageViewSchema>;

/** Body of `POST /manage/:token/cancel`: the same as `POST /me/appointments/:id/cancel`. */
export const ManageCancelInputSchema = CancelInputSchema;
export type ManageCancelInput = z.infer<typeof ManageCancelInputSchema>;
