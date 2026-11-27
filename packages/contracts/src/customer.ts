import { z } from "zod";
import { IdSchema, IsoDateSchema, IsoInstantSchema, LocaleSchema, PhoneE164Schema } from "./common";
import { EmailSchema } from "./auth";
import { AppointmentSchema, StaffAppointmentSchema } from "./booking";

export const ChannelSchema = z.enum(["WHATSAPP", "SMS", "EMAIL", "PUSH"]);
export type Channel = z.infer<typeof ChannelSchema>;

export const ConsentsSchema = z.object({
  WHATSAPP: z.boolean(),
  SMS: z.boolean(),
  EMAIL: z.boolean(),
  PUSH: z.boolean(),
});
export type Consents = z.infer<typeof ConsentsSchema>;

export const MeSchema = z.object({
  id: IdSchema,
  phoneE164: PhoneE164Schema,
  name: z.string().nullable(),
  email: z.string().nullable(),
  locale: LocaleSchema,
  consents: ConsentsSchema,
});
export type Me = z.infer<typeof MeSchema>;

export const CustomerNameSchema = z.string().trim().min(1).max(80);
export type CustomerName = z.infer<typeof CustomerNameSchema>;

export const MePatchSchema = z
  .object({
    name: CustomerNameSchema.optional(),
    email: EmailSchema.nullable().optional(),
    locale: LocaleSchema.optional(),
    consents: ConsentsSchema.partial().optional(),
    /** Where the consent was given; only with `consents`. The API defaults to `PROFILE`. */
    consentSource: z.enum(["PROFILE", "BOOKING_FORM"]).optional(),
  })
  .superRefine(({ consentSource, ...update }, ctx) => {
    if (consentSource !== undefined && update.consents === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "consentSource requires consents",
        path: ["consentSource"],
      });
    } else if (!Object.values(update).some((v) => v !== undefined)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Empty update" });
    }
  });
export type MePatch = z.infer<typeof MePatchSchema>;

export const CustomerExportSchema = z.object({
  customer: MeSchema,
  consentHistory: z.array(
    z.object({
      channel: ChannelSchema,
      granted: z.boolean(),
      source: z.enum(["BOOKING_FORM", "PROFILE", "RECEPTION", "INBOUND_STOP"]),
      changedAt: IsoInstantSchema,
    }),
  ),
  appointments: z.array(AppointmentSchema),
});
export type CustomerExport = z.infer<typeof CustomerExportSchema>;

export const CustomerSearchQuerySchema = z.object({ q: z.string().trim().min(2).max(80) });
export type CustomerSearchQuery = z.infer<typeof CustomerSearchQuerySchema>;

export const StaffCustomerSchema = MeSchema.extend({
  /** At least one consented channel the router can use today (email with an address, or a push subscription). */
  reachable: z.boolean(),
});
export type StaffCustomer = z.infer<typeof StaffCustomerSchema>;

export const StaffCustomerSearchResultSchema = StaffCustomerSchema.extend({
  /** Latest `COMPLETED` or `CHECKED_IN` appointment: local date (location timezone) and its service ids in segment order. */
  lastVisit: z.object({ date: IsoDateSchema, serviceIds: z.array(IdSchema) }).nullable(),
});
export type StaffCustomerSearchResult = z.infer<typeof StaffCustomerSearchResultSchema>;

export const StaffCustomerAppointmentsSchema = z.object({
  upcoming: z.array(StaffAppointmentSchema),
  past: z.array(StaffAppointmentSchema),
});
export type StaffCustomerAppointments = z.infer<typeof StaffCustomerAppointmentsSchema>;

export const StaffCustomerCreateSchema = z.object({
  name: CustomerNameSchema,
  phone: PhoneE164Schema,
  locale: LocaleSchema,
  email: EmailSchema.nullable().default(null),
  consents: ConsentsSchema.partial().default({}),
});
export type StaffCustomerCreate = z.infer<typeof StaffCustomerCreateSchema>;
