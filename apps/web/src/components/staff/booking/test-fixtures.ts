import type { BookingCatalog, Slot, StaffAppointment, StaffCustomerSearchResult } from "@beautyspa/contracts";

export const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const ANA = id(1);
export const BEA = id(2);
export const PEDI = id(10);
export const MANI = id(11);
export const LOC = id(50);
export const CUSTOMER = id(300);

export const catalog: BookingCatalog = {
  categories: [{ id: id(20), name: { en: "Nails", es: "Uñas" } }],
  services: [
    {
      id: PEDI,
      categoryId: id(20),
      name: { en: "Pedicure", es: "Pedicura" },
      durationMin: 45,
      priceCents: 4000,
      parallelizable: false,
      onlineBookable: true,
    },
    {
      id: MANI,
      categoryId: id(20),
      name: { en: "Manicure", es: "Manicura" },
      durationMin: 30,
      priceCents: 3000,
      parallelizable: false,
      onlineBookable: true,
    },
    {
      id: id(12),
      categoryId: null,
      name: { en: "Gel removal", es: "Retiro de gel" },
      durationMin: 20,
      priceCents: 1500,
      parallelizable: false,
      onlineBookable: false,
    },
  ],
  employees: [
    { id: ANA, displayName: "Ana", levelId: null, serviceIds: [PEDI, MANI] },
    { id: BEA, displayName: "Bea", levelId: null, serviceIds: [PEDI] },
  ],
  popularServiceIds: [PEDI],
};

export const client = (over: Partial<StaffCustomerSearchResult> = {}): StaffCustomerSearchResult => ({
  id: CUSTOMER,
  phoneE164: "+17185550123",
  name: "Maria Lopez",
  email: "maria@example.com",
  locale: "en",
  consents: { WHATSAPP: false, SMS: false, EMAIL: true, PUSH: false },
  reachable: true,
  lastVisit: { date: "2026-11-10", serviceIds: [PEDI] },
  ...over,
});

export function slot(startsAt: string, employeeId = ANA, over: Partial<Slot> = {}): Slot {
  const end = new Date(Date.parse(startsAt) + 45 * 60_000).toISOString();
  return {
    startsAt,
    endsAt: end,
    segments: [
      {
        serviceId: PEDI,
        employeeId,
        resourceId: id(30),
        startsAt,
        endsAt: end,
        blockEndsAt: end,
        durationMin: 45,
        priceCents: 4000,
      },
    ],
    ...over,
  };
}

export function appointment(over: Partial<StaffAppointment> = {}): StaffAppointment {
  const s = slot("2026-12-01T15:00:00.000Z");
  return {
    id: id(100),
    locationId: LOC,
    status: "BOOKED",
    source: "RECEPTION",
    startsAt: s.startsAt,
    endsAt: s.endsAt,
    totalPriceCents: 4000,
    notes: null,
    segments: s.segments.map((seg, i) => ({ ...seg, id: id(200 + i) })),
    confirmedByCustomerAt: null,
    cancelledAt: null,
    cancelReason: null,
    createdAt: "2026-11-20T12:00:00.000Z",
    customer: { id: CUSTOMER, name: "Maria Lopez", phoneE164: "+17185550123", reachable: true, deleted: false },
    createdByStaffId: null,
    cancelledBy: null,
    ...over,
  };
}
