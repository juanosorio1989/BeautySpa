import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Slot } from "@beautyspa/contracts";
import { CLOCK } from "../../../src/common/clock.js";
import { createIntegrationApp, resetState, resetTenancyCache } from "../app.js";
import {
  BOOKING_DATE,
  BOOKING_NOW,
  bookSegment,
  customerSession,
  fixedClock,
  seedBookingFixture,
  staffSession,
  type BookingFixture,
} from "../helpers.js";

describe("GET /availability", () => {
  const clock = fixedClock(BOOKING_NOW);
  let ctx: Awaited<ReturnType<typeof createIntegrationApp>>;
  let f: BookingFixture;

  const get = (query: string, token?: string) => {
    const req = request(ctx.app.getHttpServer()).get(`/v1/availability?${query}`);
    return token ? req.set("Authorization", `Bearer ${token}`) : req;
  };
  const pediQuery = (extra = "") => `services=${f.pediId}:ANY&date=${BOOKING_DATE}${extra}`;
  const slotsOf = async (query: string, token?: string) => {
    const res = await get(query, token);
    expect(res.status).toBe(200);
    return res.body as Slot[];
  };

  beforeAll(async () => {
    ctx = await createIntegrationApp({ override: (b) => b.overrideProvider(CLOCK).useValue(clock) });
  });
  afterAll(async () => {
    await ctx.close();
  });
  beforeEach(async () => {
    await resetState(ctx.prisma, ctx.redis);
    resetTenancyCache(ctx.app);
    clock.set(BOOKING_NOW);
    f = await seedBookingFixture(ctx.prisma);
  });

  it("offers 15-minute slots from opening to closing with the chair", async () => {
    const slots = await slotsOf(pediQuery());
    expect(slots).toHaveLength(37);
    expect(slots[0]!.startsAt).toBe("2026-12-01T14:00:00.000Z");
    expect(slots.at(-1)!.startsAt).toBe("2026-12-01T23:00:00.000Z");
    const seg = slots[0]!.segments[0]!;
    expect(seg.resourceId).toBe(f.resource1);
    expect(seg.blockEndsAt).toBe(seg.endsAt);
  });

  it("plans two parallelizable services at once with different employees", async () => {
    const slots = await slotsOf(`services=${f.pediId}:ANY&services=${f.maniId}:ANY&date=${BOOKING_DATE}`);
    const first = slots[0]!;
    expect(first.segments).toHaveLength(2);
    expect(first.segments.map((s) => s.startsAt)).toEqual(["2026-12-01T14:00:00.000Z", "2026-12-01T14:00:00.000Z"]);
    expect(new Set(first.segments.map((s) => s.employeeId)).size).toBe(2);
  });

  it("skips times where every employee is busy", async () => {
    await bookSegment(ctx.prisma, f, { staffUserId: f.staffA, startsAt: "14:00", endsAt: "15:00" });
    await bookSegment(ctx.prisma, f, {
      staffUserId: f.staffB,
      startsAt: "14:00",
      endsAt: "15:00",
      resourceId: f.resource2,
    });
    const slots = await slotsOf(pediQuery());
    expect(slots[0]!.startsAt).toBe("2026-12-01T15:00:00.000Z");
  });

  it("ignores expired holds and respects live ones", async () => {
    const hold = async (staffUserId: string, holdExpiresAt: Date) => {
      const a = await bookSegment(ctx.prisma, f, { staffUserId, startsAt: "14:00", endsAt: "15:00" });
      await ctx.prisma.appointment.update({
        where: { id: a.id },
        data: { status: "HELD", customerId: null, holdExpiresAt },
      });
    };
    await hold(f.staffA, new Date(BOOKING_NOW - 60_000));
    await hold(f.staffB, new Date(BOOKING_NOW + 60_000));
    const slots = await slotsOf(`services=${f.pediId}:${f.staffA}&date=${BOOKING_DATE}`);
    expect(slots[0]!.startsAt).toBe("2026-12-01T14:00:00.000Z");
    const slotsB = await slotsOf(`services=${f.pediId}:${f.staffB}&date=${BOOKING_DATE}`);
    expect(slotsB[0]!.startsAt).toBe("2026-12-01T15:00:00.000Z");
  });

  it("hides an employee during all-location time off", async () => {
    await ctx.prisma.timeOff.create({
      data: {
        organizationId: f.orgId,
        staffUserId: f.staffA,
        locationId: null,
        startsAt: new Date("2026-12-01T14:00:00.000Z"),
        endsAt: new Date("2026-12-01T16:00:00.000Z"),
        kind: "VACATION",
      },
    });
    const slots = await slotsOf(`services=${f.pediId}:${f.staffA}&date=${BOOKING_DATE}`);
    expect(slots[0]!.startsAt).toBe("2026-12-01T16:00:00.000Z");
  });

  it("applies lead time online but not for staff", async () => {
    clock.set(Date.parse("2026-12-01T14:30:00.000Z"));
    expect((await slotsOf(pediQuery()))[0]!.startsAt).toBe("2026-12-01T15:30:00.000Z");
    const staff = await staffSession(ctx.app, ctx.prisma, f, "OWNER");
    expect((await slotsOf(pediQuery(), staff.token))[0]!.startsAt).toBe("2026-12-01T14:30:00.000Z");
  });

  it("applies the booking horizon online but not for staff", async () => {
    const far = "2027-01-30";
    const query = `services=${f.pediId}:ANY&date=${far}`;
    expect(await slotsOf(query)).toEqual([]);
    const staff = await staffSession(ctx.app, ctx.prisma, f, "OWNER");
    expect((await slotsOf(query, staff.token)).length).toBeGreaterThan(0);
  });

  describe("excludeAppointmentId", () => {
    let appointmentId: string;
    beforeEach(async () => {
      appointmentId = (await bookSegment(ctx.prisma, f, { staffUserId: f.staffA, startsAt: "14:00", endsAt: "15:00" }))
        .id;
      await bookSegment(ctx.prisma, f, {
        staffUserId: f.staffB,
        startsAt: "14:00",
        endsAt: "15:00",
        resourceId: f.resource2,
      });
    });
    const q = () => `services=${f.pediId}:ANY&date=${BOOKING_DATE}&excludeAppointmentId=${appointmentId}`;

    it("needs a token", async () => {
      const res = await get(q());
      expect(res.status).toBe(401);
      expect(res.body.code).toBe("UNAUTHORIZED");
    });
    it("is 404 for another customer", async () => {
      const other = await ctx.prisma.customer.create({
        data: { organizationId: f.orgId, phoneE164: "+13055550199", name: "Bea", locale: "en", createdVia: "ONLINE" },
      });
      const { token } = await customerSession(ctx.app, f, other.id);
      expect((await get(q(), token)).status).toBe(404);
    });
    it("frees the appointment's own time for its owner", async () => {
      const { token } = await customerSession(ctx.app, f);
      expect((await slotsOf(q(), token))[0]!.startsAt).toBe("2026-12-01T14:00:00.000Z");
    });
    it("is allowed for staff", async () => {
      const staff = await staffSession(ctx.app, ctx.prisma, f, "OWNER");
      expect((await slotsOf(q(), staff.token))[0]!.startsAt).toBe("2026-12-01T14:00:00.000Z");
    });
  });

  it("rejects unknown services and malformed choices with 400", async () => {
    const unknown = await get(`services=${f.orgId}:ANY&date=${BOOKING_DATE}`);
    expect(unknown.status).toBe(400);
    expect(unknown.body.errors[0].path).toBe("services");
    expect((await get(`services=bad&date=${BOOKING_DATE}`)).status).toBe(400);
  });

  it("hides slots during a location closure", async () => {
    await ctx.prisma.locationClosure.create({
      data: {
        locationId: f.locationId,
        startsAt: new Date("2026-12-01T14:00:00.000Z"),
        endsAt: new Date("2026-12-01T16:00:00.000Z"),
      },
    });
    const slots = await slotsOf(pediQuery());
    expect(slots[0]!.startsAt).toBe("2026-12-01T16:00:00.000Z");
  });

  it("counts an employee's bookings at another location as busy", async () => {
    const other = await ctx.prisma.location.create({
      data: { organizationId: f.orgId, name: "Second", timezone: "America/New_York", settings: {} },
    });
    await ctx.prisma.staffLocation.create({ data: { staffUserId: f.staffA, locationId: other.id } });
    const appt = await bookSegment(ctx.prisma, f, { staffUserId: f.staffA, startsAt: "14:00", endsAt: "15:00" });
    await ctx.prisma.appointment.update({ where: { id: appt.id }, data: { locationId: other.id } });
    const slots = await slotsOf(`services=${f.pediId}:${f.staffA}&date=${BOOKING_DATE}&locationId=${f.locationId}`);
    expect(slots.map((s) => s.startsAt)).not.toContain("2026-12-01T14:00:00.000Z");
    expect(slots[0]!.startsAt).toBe("2026-12-01T15:00:00.000Z");
  });

  it("applies a level price override to the employee's slot", async () => {
    const level = await ctx.prisma.level.create({
      data: { organizationId: f.orgId, name: { en: "Senior", es: "Senior" }, rank: 1 },
    });
    await ctx.prisma.employeeProfile.update({ where: { staffUserId: f.staffA }, data: { levelId: level.id } });
    await ctx.prisma.serviceLevelPrice.create({
      data: { serviceId: f.pediId, levelId: level.id, durationMin: 90, priceCents: 5500 },
    });
    const first = (await slotsOf(`services=${f.pediId}:${f.staffA}&date=${BOOKING_DATE}`))[0]!;
    expect(Date.parse(first.endsAt) - Date.parse(first.startsAt)).toBe(90 * 60_000);
    expect(first.segments[0]!.priceCents).toBe(5500);
  });

  it("documents services as a repeated string query parameter", async () => {
    const res = await request(ctx.app.getHttpServer()).get("/v1/openapi.json");
    const params = res.body.paths["/v1/availability"].get.parameters as {
      name: string;
      schema?: { type?: string; items?: { type?: string } };
    }[];
    const services = params.filter((p) => p.name === "services");
    expect(services).toHaveLength(1);
    expect(services[0]!.schema).toMatchObject({ type: "array", items: { type: "string" } });
  });
});
