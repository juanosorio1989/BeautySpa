import { BadRequestException, NotFoundException } from "@nestjs/common";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { TokenService } from "../../../src/auth/token.service.js";
import { LocationService } from "../../../src/tenancy/location.service.js";
import { createIntegrationApp, resetState } from "../app.js";
import { seedFixture, staffSession, type Fixture } from "../helpers.js";

type Ctx = Awaited<ReturnType<typeof createIntegrationApp>>;

/** Runs `fn` and returns the thrown error (fails the test when nothing is thrown). */
async function thrown(fn: () => Promise<unknown>): Promise<unknown> {
  try {
    await fn();
  } catch (err) {
    return err;
  }
  throw new Error("expected a rejection");
}

describe("LocationService", () => {
  let ctx: Ctx;
  let f: Fixture;
  const locations = () => ctx.app.get(LocationService);

  beforeAll(async () => {
    ctx = await createIntegrationApp();
  });

  afterAll(async () => {
    await ctx.close();
  });

  beforeEach(async () => {
    await resetState(ctx.prisma, ctx.redis);
    f = await seedFixture(ctx.prisma);
  });

  const otherOrgLocation = async () => {
    const org = await ctx.prisma.organization.create({ data: { name: "Other", slug: "other", defaultLocale: "en" } });
    return ctx.prisma.location.create({
      data: { organizationId: org.id, name: "Elsewhere", timezone: "Europe/Madrid", settings: {} },
    });
  };

  describe("resolve", () => {
    it("returns the only location when no id is given", async () => {
      await expect(locations().resolve(f.orgId)).resolves.toEqual({ id: f.locationId, timezone: "America/New_York" });
    });

    it("returns a given location of the organization", async () => {
      await expect(locations().resolve(f.orgId, f.locationId)).resolves.toEqual({
        id: f.locationId,
        timezone: "America/New_York",
      });
    });

    it("answers 404 for a location of another organization", async () => {
      const other = await otherOrgLocation();
      const err = await thrown(() => locations().resolve(f.orgId, other.id));
      expect(err).toBeInstanceOf(NotFoundException);
      expect((err as NotFoundException).getResponse()).toEqual({ code: "NOT_FOUND", message: "Location not found" });
    });

    it("answers 400 on locationId when the organization has several locations", async () => {
      await ctx.prisma.location.create({
        data: { organizationId: f.orgId, name: "Second", timezone: "America/New_York", settings: {} },
      });
      const err = await thrown(() => locations().resolve(f.orgId));
      expect(err).toBeInstanceOf(BadRequestException);
      const body = (err as BadRequestException).getResponse() as { code: string; errors: { path: string }[] };
      expect(body).toEqual({
        code: "VALIDATION_FAILED",
        message: "Validation failed",
        errors: [{ path: "locationId", message: "locationId is required" }],
      });
      expect(body.errors[0]!.path).toBe("locationId");
    });

    it("throws a plain error when the organization has no location", async () => {
      const org = await ctx.prisma.organization.create({ data: { name: "Empty", slug: "empty", defaultLocale: "en" } });
      const err = await thrown(() => locations().resolve(org.id));
      expect(err).toBeInstanceOf(Error);
      expect(err).not.toBeInstanceOf(BadRequestException);
      expect(err).not.toBeInstanceOf(NotFoundException);
    });

    it("works inside a transaction client", async () => {
      const got = await ctx.prisma.$transaction((tx) => locations().resolve(f.orgId, undefined, tx));
      expect(got.id).toBe(f.locationId);
    });
  });

  describe("assertInOrg", () => {
    it("accepts ids of the organization (and an empty list)", async () => {
      await expect(locations().assertInOrg(f.orgId, [f.locationId, f.locationId], "locationIds")).resolves.toBeUndefined();
      await expect(locations().assertInOrg(f.orgId, [], "locationIds")).resolves.toBeUndefined();
    });

    it("answers 400 on the first unknown index", async () => {
      const other = await otherOrgLocation();
      const err = await thrown(() =>
        locations().assertInOrg(f.orgId, [f.locationId, other.id, "0194b2a0-0000-7000-8000-0000000000ff"], "locationIds"),
      );
      expect(err).toBeInstanceOf(BadRequestException);
      expect((err as BadRequestException).getResponse()).toEqual({
        code: "VALIDATION_FAILED",
        message: "Validation failed",
        errors: [{ path: "locationIds.1", message: "Unknown location" }],
      });
    });
  });
});

describe("staffSession test helper", () => {
  let ctx: Ctx;

  beforeAll(async () => {
    ctx = await createIntegrationApp();
  });

  afterAll(async () => {
    await ctx.close();
  });

  it("creates an enrolled staff user and a valid access token", async () => {
    await resetState(ctx.prisma, ctx.redis);
    const f = await seedFixture(ctx.prisma);
    const { id, token } = await staffSession(ctx.app, ctx.prisma, f, "RECEPTION");
    await expect(ctx.app.get(TokenService).verifyAccess(token)).resolves.toEqual({
      sub: id,
      typ: "staff",
      org: f.orgId,
      role: "RECEPTION",
    });
    const user = await ctx.prisma.staffUser.findUniqueOrThrow({ where: { id } });
    expect(user).toMatchObject({ role: "RECEPTION", canLogin: true, active: true });
    expect(user.totpEnrolledAt).not.toBeNull();
  });
});
