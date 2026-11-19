import { describe, expect, it } from "vitest";
import {
  ClosureQuerySchema,
  DEFAULT_LOCATION_SETTINGS,
  LocationSettingsSchema,
  StaffSettingsPatchSchema,
} from "./settings";

describe("LocationSettingsSchema", () => {
  it("validates slot interval and hold minutes", () => {
    expect(LocationSettingsSchema.safeParse(DEFAULT_LOCATION_SETTINGS).success).toBe(true);
    expect(LocationSettingsSchema.safeParse({ ...DEFAULT_LOCATION_SETTINGS, slotIntervalMin: 7 }).success).toBe(false);
    expect(LocationSettingsSchema.safeParse({ ...DEFAULT_LOCATION_SETTINGS, holdMinutes: 0 }).success).toBe(false);
  });
});

describe("StaffSettingsPatchSchema / ClosureQuerySchema", () => {
  it("rejects empty patch", () => {
    expect(StaffSettingsPatchSchema.safeParse({}).success).toBe(false);
    expect(StaffSettingsPatchSchema.safeParse({ settings: { holdMinutes: 10 } }).success).toBe(true);
  });
  it("rejects from > to", () => {
    expect(ClosureQuerySchema.safeParse({ from: "2026-02-01T00:00:00Z", to: "2026-01-01T00:00:00Z" }).success).toBe(
      false,
    );
  });
});
