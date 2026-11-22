import { describe, expect, it } from "vitest";
import type { PlannedSegment, PublicEmployee, PublicService, Slot } from "@beautyspa/contracts";
import { en } from "@beautyspa/i18n";
import { slotSummary } from "./slot-summary";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const seg = (n: number, start: string, end: string, price: number, emp = id(10 + n)): PlannedSegment => ({
  serviceId: id(n),
  employeeId: emp,
  resourceId: null,
  startsAt: start,
  endsAt: end,
  blockEndsAt: end,
  durationMin: 30,
  priceCents: price,
});
const services = [1, 2].map((n): PublicService => ({
  id: id(n),
  categoryId: null,
  name: { en: `Svc ${n}`, es: `Serv ${n}` },
  description: null,
  durationMin: 30,
  priceCents: 2500,
  fromPriceCents: 2500,
  parallelizable: true,
}));
const employees = [11, 12].map((n): PublicEmployee => ({
  id: id(n),
  displayName: `Emp ${n}`,
  bio: null,
  photoUrl: null,
  level: null,
  serviceIds: [],
}));
const slot = (segments: PlannedSegment[]): Slot => ({
  startsAt: segments[0]!.startsAt,
  endsAt: segments[segments.length - 1]!.endsAt,
  segments,
});

describe("slotSummary", () => {
  it("marks overlapping segments as parallel and totals exact prices", () => {
    const s = slotSummary(
      slot([
        seg(1, "2026-11-19T16:00:00Z", "2026-11-19T16:30:00Z", 2500),
        seg(2, "2026-11-19T16:00:00Z", "2026-11-19T16:45:00Z", 4100),
      ]),
      services,
      employees,
      "en",
    );
    expect(s.parallel).toBe(true);
    expect(s.totalCents).toBe(6600);
    expect(s.lines).toEqual([
      { serviceName: "Svc 1", employeeName: "Emp 11", priceCents: 2500 },
      { serviceName: "Svc 2", employeeName: "Emp 12", priceCents: 4100 },
    ]);
  });

  it("is not parallel for back-to-back segments", () => {
    const s = slotSummary(
      slot([
        seg(1, "2026-11-19T16:00:00Z", "2026-11-19T16:30:00Z", 2500),
        seg(2, "2026-11-19T16:30:00Z", "2026-11-19T17:00:00Z", 2500),
      ]),
      services,
      employees,
      "en",
    );
    expect(s.parallel).toBe(false);
  });

  it("falls back to 'your professional' for an unknown employee", () => {
    const s = slotSummary(
      slot([seg(1, "2026-11-19T16:00:00Z", "2026-11-19T16:30:00Z", 2500, id(99))]),
      services,
      employees,
      "en",
    );
    expect(s.lines[0]!.employeeName).toBe(en.booking.time.yourProfessional);
  });
});
