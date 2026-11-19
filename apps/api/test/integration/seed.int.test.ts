import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { seed } from "../../prisma/seed.js";
import { createIntegrationApp, resetState, resetTenancyCache } from "./app.js";

describe("development seed", () => {
  let ctx: Awaited<ReturnType<typeof createIntegrationApp>>;

  beforeAll(async () => {
    ctx = await createIntegrationApp({
      env: { DEFAULT_ORG_SLUG: "demo-salon" },
    });
  });
  afterAll(async () => {
    await ctx.close();
  });
  beforeEach(async () => {
    await resetState(ctx.prisma, ctx.redis);
    resetTenancyCache(ctx.app);
  });

  it("is idempotent and builds a bookable demo salon", async () => {
    await seed(ctx.prisma, { today: "2026-12-01" });
    const counts = await seed(ctx.prisma, { today: "2026-12-01" });

    const p = ctx.prisma;
    const actual = {
      levels: await p.level.count(),
      categories: await p.serviceCategory.count(),
      services: await p.service.count(),
      levelPrices: await p.serviceLevelPrice.count(),
      resourceTypes: await p.resourceType.count(),
      resources: await p.resource.count(),
      staff: await p.staffUser.count(),
      workingHours: await p.workingHours.count(),
      customers: await p.customer.count(),
      consents: await p.notificationConsent.count(),
      appointments: await p.appointment.count(),
      segments: await p.appointmentSegment.count(),
    };
    expect(actual).toEqual({
      levels: 2,
      categories: 5,
      services: 20,
      levelPrices: 3,
      resourceTypes: 2,
      resources: 5,
      staff: 5,
      workingHours: 50,
      customers: 3,
      consents: 2,
      appointments: 3,
      segments: 4,
    });
    expect(counts).toEqual(actual);

    const maria = await p.appointment.findFirstOrThrow({
      where: { customer: { phoneE164: "+17185550101" } },
      include: { segments: true },
    });
    expect(maria.segments).toHaveLength(2);
    for (const s of maria.segments) expect(s.startsAt.toISOString()).toBe("2026-12-01T15:00:00.000Z");

    const res = await request(ctx.app.getHttpServer()).get("/v1/public/services");
    expect(res.status).toBe(200);
    expect(res.body.services).toHaveLength(20);
  });
});
