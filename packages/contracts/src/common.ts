import { z } from "zod";

export const IdSchema = z.string().uuid();
export type Id = z.infer<typeof IdSchema>;

export const PhoneE164Schema = z.string().regex(/^\+[1-9]\d{7,14}$/);
export type PhoneE164 = z.infer<typeof PhoneE164Schema>;

export const LocaleSchema = z.enum(["en", "es"]);
export type Locale = z.infer<typeof LocaleSchema>;

export const LocalizedTextSchema = z.object({ en: z.string().min(1), es: z.string().min(1) });
export type LocalizedText = z.infer<typeof LocalizedTextSchema>;

export const MoneyCentsSchema = z.number().int().nonnegative();
export type MoneyCents = z.infer<typeof MoneyCentsSchema>;

/** Query-string boolean: only "true" or "false" (use with `.default("false")`). */
export const QueryBooleanSchema = z.enum(["true", "false"]).transform((v) => v === "true");

export const IsoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((s) => {
    const d = new Date(`${s}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
  }, "Invalid date");
export type IsoDate = z.infer<typeof IsoDateSchema>;

export const IsoInstantSchema = z.string().datetime({ offset: true });
export type IsoInstant = z.infer<typeof IsoInstantSchema>;

export const WallTimeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
export type WallTime = z.infer<typeof WallTimeSchema>;

export const EndWallTimeSchema = z.union([WallTimeSchema, z.literal("24:00")]);
export type EndWallTime = z.infer<typeof EndWallTimeSchema>;

export const WeekdaySchema = z.number().int().min(0).max(6);
export type Weekday = z.infer<typeof WeekdaySchema>;

export const DayHoursSchema = z
  .object({ weekday: WeekdaySchema, start: WallTimeSchema, end: EndWallTimeSchema })
  .refine((o) => o.start < o.end, { message: "end must be after start", path: ["end"] });
export type DayHours = z.infer<typeof DayHoursSchema>;

export const WeekHoursSchema = z
  .array(DayHoursSchema)
  .max(50)
  .superRefine((days, ctx) => {
    const order = days
      .map((_, i) => i)
      .sort((a, b) => {
        const x = days[a]!;
        const y = days[b]!;
        return x.weekday - y.weekday || (x.start < y.start ? -1 : x.start > y.start ? 1 : 0);
      });
    let prev: DayHours | undefined;
    for (const i of order) {
      const cur = days[i]!;
      if (prev && prev.weekday === cur.weekday && cur.start < prev.end) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Overlapping ranges", path: [i] });
      }
      if (!prev || prev.weekday !== cur.weekday || cur.end > prev.end) prev = cur;
    }
  });
export type WeekHours = z.infer<typeof WeekHoursSchema>;

function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

export const TimezoneSchema = z.string().min(1).max(64).refine(isValidTimeZone, "Invalid timezone");
export type Timezone = z.infer<typeof TimezoneSchema>;
