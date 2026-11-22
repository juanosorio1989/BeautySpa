import type { PlannedSegment, PublicEmployee, PublicLocation, PublicService, Slot } from "@beautyspa/contracts";

export const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

export const svc = (n: number, over: Partial<PublicService> = {}): PublicService => ({
  id: id(n),
  categoryId: id(100),
  name: { en: `Svc ${n}`, es: `Serv ${n}` },
  description: null,
  durationMin: 30,
  priceCents: 2500,
  fromPriceCents: 2500,
  parallelizable: false,
  ...over,
});

export const emp = (n: number, serviceIds: string[]): PublicEmployee => ({
  id: id(n),
  displayName: `Emp ${n}`,
  bio: null,
  photoUrl: null,
  level: null,
  serviceIds,
});

export const location: PublicLocation = {
  id: id(200),
  name: "Demo Salon",
  address: null,
  phone: null,
  timezone: "America/New_York",
  hours: [],
  booking: { bookingHorizonDays: 30, cancelWindowHours: 24, holdMinutes: 5 },
};

export const seg = (
  serviceN: number,
  empN: number,
  startsAt: string,
  endsAt: string,
  price = 2500,
): PlannedSegment => ({
  serviceId: id(serviceN),
  employeeId: id(empN),
  resourceId: null,
  startsAt,
  endsAt,
  blockEndsAt: endsAt,
  durationMin: 30,
  priceCents: price,
});

export const slot = (start: string, end: string, segments = [seg(1, 11, start, end)]): Slot => ({
  startsAt: start,
  endsAt: end,
  segments,
});
