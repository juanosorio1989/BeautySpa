import { describe, expect, it } from "vitest";
import { isReminderDue, REMINDERS } from "./reminder-due.js";

const H = 3_600_000;
const S = Date.parse("2026-12-01T14:00:00.000Z");
const [r24, r2] = REMINDERS;
const appt = (timesSetAt: number) => ({ startsAt: new Date(S), timesSetAt: new Date(timesSetAt) });

describe("reminder due predicate edges", () => {
  it("24h reminder is due exactly 24h before when booked then", () => {
    expect(isReminderDue(r24, appt(S - 24 * H), S - 24 * H)).toBe(true);
  });
  it("24h reminder is skipped when the times were set less than 24h before", () => {
    expect(isReminderDue(r24, appt(S - 24 * H + 60_000), S - 24 * H + 60_000)).toBe(false);
  });
  it("24h reminder is not sent once the 2h one is due", () => {
    expect(isReminderDue(r24, appt(S - 48 * H), S - 2 * H)).toBe(false);
    expect(isReminderDue(r24, appt(S - 48 * H), S - 2 * H - 1)).toBe(true);
  });
  it("2h reminder is never sent at or after the start", () => {
    expect(isReminderDue(r2, appt(S - 48 * H), S)).toBe(false);
    expect(isReminderDue(r2, appt(S - 48 * H), S - 1)).toBe(true);
  });
  it("is not due before the window opens", () => {
    expect(isReminderDue(r24, appt(S - 48 * H), S - 24 * H - 1)).toBe(false);
  });
});
