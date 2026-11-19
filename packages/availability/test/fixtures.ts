import { wallTimeToUtc } from "@beautyspa/datetime";
import type { IsoDate, WallTime, Weekday } from "@beautyspa/datetime";
import type { EmployeeInput, LocationInput, ResourceInput, ServiceInput, WeeklyHours } from "../src/types";

export const NY = "America/New_York";
export const MON: IsoDate = "2026-12-07";
export const at = (date: IsoDate, time: WallTime): number => wallTimeToUtc(date, time, NY);

const WEEKDAYS: Weekday[] = [0, 1, 2, 3, 4, 5, 6];
export const everyDay = (start: WallTime, end: WallTime): WeeklyHours[] =>
  WEEKDAYS.map((weekday) => ({ weekday, start, end }));

export const ANA_ID = "00000000-0000-4000-8000-00000000000a";
export const BEA_ID = "00000000-0000-4000-8000-00000000000b";
export const CARLA_ID = "00000000-0000-4000-8000-00000000000c";
export const DANI_ID = "00000000-0000-4000-8000-00000000000d";
export const MANI_ID = "00000000-0000-4000-8000-0000000000a1";
export const PEDI_ID = "00000000-0000-4000-8000-0000000000a2";
export const GEL_ID = "00000000-0000-4000-8000-0000000000a3";
export const HAIRCUT_ID = "00000000-0000-4000-8000-0000000000a4";
export const JUNIOR = "00000000-0000-4000-8000-0000000000b1";
export const SENIOR = "00000000-0000-4000-8000-0000000000b2";
export const CHAIR = "00000000-0000-4000-8000-0000000000c1";
export const CHAIR_1_ID = "00000000-0000-4000-8000-0000000000d1";
export const CHAIR_2_ID = "00000000-0000-4000-8000-0000000000d2";

export const makeLocation = (o: Partial<LocationInput> = {}): LocationInput => ({
  timezone: NY,
  slotIntervalMin: 15,
  minLeadMinutes: 60,
  bookingHorizonDays: 60,
  hours: everyDay("09:00", "19:00"),
  closures: [],
  ...o,
});
export const location = makeLocation();

export const makeService = (base: ServiceInput, o: Partial<ServiceInput> = {}): ServiceInput => ({
  ...base,
  ...o,
});
export const mani: ServiceInput = {
  id: MANI_ID,
  durationMin: 30,
  bufferAfterMin: 10,
  priceCents: 2500,
  parallelizable: true,
  resourceTypeId: null,
  onlineBookable: true,
  levelOverrides: {},
};
export const pedi: ServiceInput = {
  id: PEDI_ID,
  durationMin: 45,
  bufferAfterMin: 15,
  priceCents: 4000,
  parallelizable: true,
  resourceTypeId: CHAIR,
  onlineBookable: true,
  levelOverrides: {},
};
export const gel: ServiceInput = {
  id: GEL_ID,
  durationMin: 15,
  bufferAfterMin: 0,
  priceCents: 1500,
  parallelizable: true,
  resourceTypeId: null,
  onlineBookable: true,
  levelOverrides: {},
};
export const haircut: ServiceInput = {
  id: HAIRCUT_ID,
  durationMin: 60,
  bufferAfterMin: 0,
  priceCents: 5000,
  parallelizable: false,
  resourceTypeId: null,
  onlineBookable: true,
  levelOverrides: { [SENIOR]: { durationMin: 45, priceCents: 7000 } },
};

export const makeEmployee = (base: EmployeeInput, o: Partial<EmployeeInput> = {}): EmployeeInput => ({
  ...base,
  ...o,
});
const baseEmployee = (id: string, levelId: string, serviceIds: string[]): EmployeeInput => ({
  id,
  levelId,
  serviceIds,
  workingHours: everyDay("09:00", "19:00"),
  timeOff: [],
  bookableOnline: true,
});
export const ana = baseEmployee(ANA_ID, JUNIOR, [MANI_ID, PEDI_ID, GEL_ID]);
export const bea = baseEmployee(BEA_ID, JUNIOR, [MANI_ID, PEDI_ID, GEL_ID]);
export const carla = baseEmployee(CARLA_ID, SENIOR, [HAIRCUT_ID]);
export const dani = baseEmployee(DANI_ID, JUNIOR, [HAIRCUT_ID]);

export const makeResource = (base: ResourceInput, o: Partial<ResourceInput> = {}): ResourceInput => ({
  ...base,
  ...o,
});
export const chair1: ResourceInput = { id: CHAIR_1_ID, resourceTypeId: CHAIR, name: "chair-1" };
export const chair2: ResourceInput = { id: CHAIR_2_ID, resourceTypeId: CHAIR, name: "chair-2" };
