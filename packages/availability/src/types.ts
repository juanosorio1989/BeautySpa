import type { IsoDate, WallTime, Weekday } from "@beautyspa/datetime";

export type Ms = number;
/** Half-open interval [start, end). */
export interface Interval {
  start: Ms;
  end: Ms;
}
export interface WeeklyHours {
  weekday: Weekday;
  start: WallTime;
  end: WallTime;
}
export interface LocationInput {
  timezone: string;
  slotIntervalMin: number;
  minLeadMinutes: number;
  bookingHorizonDays: number;
  hours: WeeklyHours[];
  closures: Interval[];
}
export interface ServiceInput {
  id: string;
  durationMin: number;
  bufferAfterMin: number;
  priceCents: number;
  parallelizable: boolean;
  resourceTypeId: string | null;
  onlineBookable: boolean;
  levelOverrides: Record<string, { durationMin: number; priceCents: number }>;
}
export interface EmployeeInput {
  id: string;
  levelId: string | null;
  serviceIds: string[];
  workingHours: WeeklyHours[];
  timeOff: Interval[];
  bookableOnline: boolean;
}
export interface ResourceInput {
  id: string;
  resourceTypeId: string;
  name: string;
}
export interface BusySegment {
  employeeId: string;
  resourceId: string | null;
  start: Ms;
  blockEnd: Ms;
}

export type Mode = "ONLINE" | "STAFF";
export interface ServiceChoice {
  serviceId: string;
  employeeId: string | "ANY";
}
export interface PlannedSegment {
  serviceId: string;
  employeeId: string;
  resourceId: string | null;
  start: Ms;
  end: Ms;
  blockEnd: Ms;
  durationMin: number;
  priceCents: number;
}
export interface Slot {
  start: Ms;
  end: Ms;
  segments: PlannedSegment[];
}
export interface Context {
  location: LocationInput;
  services: ServiceInput[];
  employees: EmployeeInput[];
  resources: ResourceInput[];
  busy: BusySegment[];
  mode: Mode;
  now: Ms;
  override?: boolean;
}
export interface FindSlotsInput extends Context {
  choices: ServiceChoice[];
  date: IsoDate;
}
export type PlanRejection =
  | "NOT_QUALIFIED"
  | "EMPLOYEE_UNAVAILABLE"
  | "RESOURCE_UNAVAILABLE"
  | "TOO_SOON"
  | "BEYOND_HORIZON"
  | "NOT_BOOKABLE_ONLINE"
  | "MALFORMED_PLAN";
