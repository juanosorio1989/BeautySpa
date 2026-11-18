import type { WallTime, Weekday } from "@beautyspa/datetime";

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
