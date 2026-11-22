import type {
  Appointment,
  Me,
  PlannedSegment,
  PublicEmployee,
  PublicLocation,
  PublicService,
  Slot,
} from "@beautyspa/contracts";

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

export const me = (over: Partial<Me> = {}): Me => ({
  id: id(300),
  phoneE164: "+17185550123",
  name: null,
  email: null,
  locale: "en",
  consents: { WHATSAPP: false, SMS: false, EMAIL: false },
  ...over,
});

export const appointment = (over: Partial<Appointment> = {}): Appointment => ({
  id: id(400),
  locationId: id(200),
  status: "BOOKED",
  source: "ONLINE",
  startsAt: "2026-11-19T16:00:00.000Z",
  endsAt: "2026-11-19T16:45:00.000Z",
  totalPriceCents: 6500,
  notes: null,
  segments: [
    { ...seg(1, 11, "2026-11-19T16:00:00.000Z", "2026-11-19T16:30:00.000Z", 2500), id: id(401) },
    { ...seg(2, 12, "2026-11-19T16:00:00.000Z", "2026-11-19T16:45:00.000Z", 4000), id: id(402) },
  ],
  confirmedByCustomerAt: null,
  cancelledAt: null,
  cancelReason: null,
  createdAt: "2026-11-18T16:00:00.000Z",
  ...over,
});
