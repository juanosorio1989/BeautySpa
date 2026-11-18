import { z } from "zod";
import { StaffRoleSchema, EmailSchema } from "./auth";
import { DayHoursSchema, IdSchema, IsoInstantSchema, LocaleSchema, LocalizedTextSchema, WeekHoursSchema } from "./common";

const nonEmpty = (o: object) => Object.keys(o).length > 0;
const EMPTY = "Empty update";
const DAY_MS = 86_400_000;
const MAX_SPAN_MS = 366 * DAY_MS;

export const EmployeeProfileSchema = z.object({
  displayName: z.string().trim().min(1).max(60),
  bio: LocalizedTextSchema.nullable().default(null),
  photoUrl: z.string().url().startsWith("https://").max(500).nullable().default(null),
  levelId: IdSchema.nullable().default(null),
  bookableOnline: z.boolean().default(true),
});
export type EmployeeProfile = z.infer<typeof EmployeeProfileSchema>;

function uniqueIds(ids: string[] | undefined, path: string, ctx: z.RefinementCtx): void {
  if (ids && new Set(ids).size !== ids.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Duplicate ids", path: [path] });
  }
}

const EmployeeCreateFieldsSchema = z.object({
  role: StaffRoleSchema,
  email: EmailSchema.nullable().default(null),
  locale: LocaleSchema,
  canLogin: z.boolean().default(false),
  locationIds: z.array(IdSchema).min(1).max(10).optional(),
  profile: EmployeeProfileSchema.nullable().default(null),
  serviceIds: z.array(IdSchema).max(100).default([]),
  sendInvite: z.boolean().default(false),
});

export const EmployeeCreateSchema = EmployeeCreateFieldsSchema.superRefine((o, ctx) => {
  if (o.canLogin && !o.email) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "canLogin requires email", path: ["email"] });
  }
  if (o.sendInvite && !o.canLogin) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "sendInvite requires canLogin", path: ["sendInvite"] });
  }
  if (o.serviceIds.length > 0 && !o.profile) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "serviceIds require a profile", path: ["serviceIds"] });
  }
  uniqueIds(o.locationIds, "locationIds", ctx);
  uniqueIds(o.serviceIds, "serviceIds", ctx);
});
export type EmployeeCreate = z.infer<typeof EmployeeCreateSchema>;

export const EmployeeUpdateSchema = EmployeeCreateFieldsSchema.pick({
  role: true,
  email: true,
  locale: true,
  canLogin: true,
  locationIds: true,
  profile: true,
  serviceIds: true,
})
  .extend({ active: z.boolean() })
  .partial()
  .refine(nonEmpty, EMPTY);
export type EmployeeUpdate = z.infer<typeof EmployeeUpdateSchema>;

export const EmployeeSchema = z.object({
  id: IdSchema,
  role: StaffRoleSchema,
  email: z.string().nullable(),
  locale: LocaleSchema,
  canLogin: z.boolean(),
  active: z.boolean(),
  hasPassword: z.boolean(),
  mfaEnrolled: z.boolean(),
  locationIds: z.array(IdSchema),
  profile: EmployeeProfileSchema.nullable(),
  serviceIds: z.array(IdSchema),
});
export type Employee = z.infer<typeof EmployeeSchema>;

export const WorkingHoursQuerySchema = z.object({ locationId: IdSchema.optional() });
export type WorkingHoursQuery = z.infer<typeof WorkingHoursQuerySchema>;
export const WorkingHoursPutSchema = z.object({ days: WeekHoursSchema });
export type WorkingHoursPut = z.infer<typeof WorkingHoursPutSchema>;
export const WorkingHoursSchema = z.object({
  employeeId: IdSchema,
  locationId: IdSchema,
  days: z.array(DayHoursSchema),
});
export type WorkingHours = z.infer<typeof WorkingHoursSchema>;

export const TimeOffKindSchema = z.enum(["VACATION", "BLOCK"]);
export type TimeOffKind = z.infer<typeof TimeOffKindSchema>;

function checkRange(o: { startsAt: string; endsAt: string }, ctx: z.RefinementCtx, path: string): void {
  const s = Date.parse(o.startsAt);
  const e = Date.parse(o.endsAt);
  if (!(s < e)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "endsAt must be after startsAt", path: [path] });
  } else if (e - s > MAX_SPAN_MS) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Range must not exceed 366 days", path: [path] });
  }
}

/** Shared by staff and settings modules: startsAt < endsAt and span <= 366 days (issue on endsAt). */
export function refineInstantRange(o: { startsAt: string; endsAt: string }, ctx: z.RefinementCtx): void {
  checkRange(o, ctx, "endsAt");
}

const TimeOffFieldsSchema = z.object({
  employeeId: IdSchema,
  locationId: IdSchema.nullable().default(null),
  startsAt: IsoInstantSchema,
  endsAt: IsoInstantSchema,
  kind: TimeOffKindSchema,
  note: z.string().trim().max(500).nullable().default(null),
});

export const TimeOffInputSchema = TimeOffFieldsSchema.superRefine(refineInstantRange);
export type TimeOffInput = z.infer<typeof TimeOffInputSchema>;
export const TimeOffUpdateSchema = TimeOffFieldsSchema.pick({
  locationId: true,
  startsAt: true,
  endsAt: true,
  kind: true,
  note: true,
})
  .partial()
  .refine(nonEmpty, EMPTY);
export type TimeOffUpdate = z.infer<typeof TimeOffUpdateSchema>;
export const TimeOffSchema = z.object({
  id: IdSchema,
  employeeId: IdSchema,
  locationId: IdSchema.nullable(),
  startsAt: IsoInstantSchema,
  endsAt: IsoInstantSchema,
  kind: TimeOffKindSchema,
  note: z.string().nullable(),
});
export type TimeOff = z.infer<typeof TimeOffSchema>;

/** from < to and span <= 366 days (issue on `to`). */
export function refineQueryRange(o: { from: string; to: string }, ctx: z.RefinementCtx): void {
  const s = Date.parse(o.from);
  const e = Date.parse(o.to);
  if (!(s < e)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "to must be after from", path: ["to"] });
  } else if (e - s > MAX_SPAN_MS) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Range must not exceed 366 days", path: ["to"] });
  }
}

export const TimeOffQuerySchema = z
  .object({
    from: IsoInstantSchema,
    to: IsoInstantSchema,
    employeeId: IdSchema.optional(),
    locationId: IdSchema.optional(),
  })
  .superRefine(refineQueryRange);
export type TimeOffQuery = z.infer<typeof TimeOffQuerySchema>;
