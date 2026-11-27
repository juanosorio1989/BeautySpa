import { z } from "zod";
import {
  IdSchema,
  IsoDateSchema,
  IsoInstantSchema,
  LocalizedTextSchema,
  MoneyCentsSchema,
  QueryBooleanSchema,
  TimezoneSchema,
} from "./common";
import { PlannedSegmentSchema, ServiceChoiceSchema } from "./availability";

export const AppointmentStatusSchema = z.enum(["HELD", "BOOKED", "CHECKED_IN", "COMPLETED", "CANCELLED", "NO_SHOW"]);
export type AppointmentStatus = z.infer<typeof AppointmentStatusSchema>;

export const AppointmentSourceSchema = z.enum(["ONLINE", "RECEPTION", "WALK_IN"]);
export type AppointmentSource = z.infer<typeof AppointmentSourceSchema>;

export const PlanSegmentsSchema = z.array(PlannedSegmentSchema).min(1).max(4);
export type PlanSegments = z.infer<typeof PlanSegmentsSchema>;

export const HoldInputSchema = z.object({ locationId: IdSchema.optional(), segments: PlanSegmentsSchema });
export type HoldInput = z.infer<typeof HoldInputSchema>;

export const HoldSchema = z.object({ holdId: IdSchema, expiresAt: IsoInstantSchema });
export type Hold = z.infer<typeof HoldSchema>;

export const NotesSchema = z.string().trim().max(500);
export type Notes = z.infer<typeof NotesSchema>;

/** Optional free text: trimmed, at most `max` chars, missing or blank (`""` after trim) → `null`. */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .transform((v) => (v === "" ? null : v))
    .default(null);
const OptionalNotesSchema = optionalText(500);
const OptionalReasonSchema = optionalText(200);

export const BookInputSchema = z.object({ holdId: IdSchema, notes: OptionalNotesSchema });
export type BookInput = z.infer<typeof BookInputSchema>;

export const AppointmentSegmentSchema = PlannedSegmentSchema.extend({ id: IdSchema });
export type AppointmentSegment = z.infer<typeof AppointmentSegmentSchema>;

// startsAt = min segment start, endsAt = max segment end.
export const AppointmentSchema = z.object({
  id: IdSchema,
  locationId: IdSchema,
  status: AppointmentStatusSchema,
  source: AppointmentSourceSchema,
  startsAt: IsoInstantSchema,
  endsAt: IsoInstantSchema,
  totalPriceCents: MoneyCentsSchema,
  notes: z.string().nullable(),
  segments: z.array(AppointmentSegmentSchema),
  confirmedByCustomerAt: IsoInstantSchema.nullable(),
  cancelledAt: IsoInstantSchema.nullable(),
  cancelReason: z.string().nullable(),
  createdAt: IsoInstantSchema,
});
export type Appointment = z.infer<typeof AppointmentSchema>;

export const CustomerSummarySchema = z.object({
  id: IdSchema,
  name: z.string().nullable(),
  phoneE164: z.string(),
  /** At least one consented channel the router can use today (email with an address, or a push subscription). */
  reachable: z.boolean(),
  /** The account was deleted and anonymized: `phoneE164` is a placeholder and there is no client page. */
  deleted: z.boolean(),
});
export type CustomerSummary = z.infer<typeof CustomerSummarySchema>;

export const StaffAppointmentSchema = AppointmentSchema.extend({
  customer: CustomerSummarySchema.nullable(),
  createdByStaffId: IdSchema.nullable(),
  cancelledBy: z.enum(["STAFF", "CUSTOMER", "SYSTEM"]).nullable(),
});
export type StaffAppointment = z.infer<typeof StaffAppointmentSchema>;

export const MyAppointmentsSchema = z.object({
  upcoming: z.array(AppointmentSchema),
  past: z.array(AppointmentSchema),
});
export type MyAppointments = z.infer<typeof MyAppointmentsSchema>;

export const CancelInputSchema = z.object({ reason: OptionalReasonSchema });
export type CancelInput = z.infer<typeof CancelInputSchema>;

export const RescheduleInputSchema = z.object({ segments: PlanSegmentsSchema });
export type RescheduleInput = z.infer<typeof RescheduleInputSchema>;

export const RepeatSchema = z.object({ locationId: IdSchema, services: z.array(ServiceChoiceSchema) });
export type Repeat = z.infer<typeof RepeatSchema>;

export const StaffAppointmentInputSchema = z.object({
  customerId: IdSchema,
  locationId: IdSchema.optional(),
  segments: PlanSegmentsSchema,
  notes: OptionalNotesSchema,
  override: z.boolean().default(false),
});
export type StaffAppointmentInput = z.infer<typeof StaffAppointmentInputSchema>;

export const StaffAppointmentPatchSchema = z.object({
  segments: PlanSegmentsSchema,
  override: z.boolean().default(false),
});
export type StaffAppointmentPatch = z.infer<typeof StaffAppointmentPatchSchema>;

export const StatusChangeSchema = z.object({
  status: z.enum(["CHECKED_IN", "COMPLETED", "NO_SHOW", "CANCELLED"]),
  reason: OptionalReasonSchema,
});
export type StatusChange = z.infer<typeof StatusChangeSchema>;

export const WalkInInputSchema = z.object({
  customerId: IdSchema.nullable().default(null),
  locationId: IdSchema.optional(),
  services: z.array(ServiceChoiceSchema).min(1).max(4),
  notes: OptionalNotesSchema,
});
export type WalkInInput = z.infer<typeof WalkInInputSchema>;

export const AgendaQuerySchema = z.object({
  date: IsoDateSchema,
  locationId: IdSchema.optional(),
  employeeId: IdSchema.optional(),
  includeCancelled: QueryBooleanSchema.default("false"),
});
export type AgendaQuery = z.infer<typeof AgendaQuerySchema>;

export const AgendaEmployeeSchema = z.object({
  id: IdSchema,
  displayName: z.string(),
  active: z.boolean(),
  /** Working hours of the local day after location hours, closures and time off (no appointments subtracted). */
  ranges: z.array(z.object({ start: IsoInstantSchema, end: IsoInstantSchema })),
});
export type AgendaEmployee = z.infer<typeof AgendaEmployeeSchema>;

export const AgendaSchema = z.object({
  date: IsoDateSchema,
  locationId: IdSchema,
  timezone: TimezoneSchema,
  appointments: z.array(StaffAppointmentSchema),
  employees: z.array(AgendaEmployeeSchema),
  services: z.array(z.object({ id: IdSchema, name: LocalizedTextSchema })),
  resources: z.array(z.object({ id: IdSchema, name: z.string() })),
});
export type Agenda = z.infer<typeof AgendaSchema>;
