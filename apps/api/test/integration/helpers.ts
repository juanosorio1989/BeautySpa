import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { PrismaClient, type StaffRole } from "@prisma/client";
import { Encryptor } from "../../src/auth/crypto/encryption.js";
import { hashPassword } from "../../src/auth/crypto/password.js";
import { generateTotpSecret } from "../../src/auth/crypto/totp.js";
import { TokenService } from "../../src/auth/token.service.js";
import type { Clock } from "../../src/common/clock.js";
import { pgCode } from "../../src/common/db-errors.js";
import { wallToTime } from "../../src/common/wall-time.js";
import { testEnv } from "../support/test-env.js";
import { testDatabaseUrl } from "./setup.js";

export { pgCode };

export function createTestClient(): PrismaClient {
  return new PrismaClient({ datasourceUrl: testDatabaseUrl() });
}

/** Empties every application table (keeps `_prisma_migrations`). */
export async function truncateAll(prisma: PrismaClient): Promise<void> {
  const rows = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  if (rows.length === 0) return;
  const list = rows.map((r) => `"public"."${r.tablename}"`).join(", ");
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
}

export async function rejectionCode(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
  } catch (err) {
    return pgCode(err) ?? `unrecognized: ${(err as Error).message}`;
  }
  return undefined;
}

export interface Fixture {
  orgId: string;
  locationId: string;
  staffA: string;
  staffB: string;
  serviceId: string;
  resourceTypeId: string;
  resource1: string;
  resource2: string;
  customerId: string;
}

export async function seedFixture(prisma: PrismaClient): Promise<Fixture> {
  const org = await prisma.organization.create({
    data: { name: "Test Salon", slug: "test-salon", defaultLocale: "en" },
  });
  const location = await prisma.location.create({
    data: { organizationId: org.id, name: "Main", timezone: "America/New_York", settings: {} },
  });
  const staffA = await prisma.staffUser.create({
    data: { organizationId: org.id, email: "a@test.dev", role: "EMPLOYEE", locale: "en" },
  });
  const staffB = await prisma.staffUser.create({
    data: { organizationId: org.id, email: "b@test.dev", role: "EMPLOYEE", locale: "en" },
  });
  const resourceType = await prisma.resourceType.create({
    data: { organizationId: org.id, name: { en: "Pedicure chair", es: "Silla de pedicura" } },
  });
  const resource1 = await prisma.resource.create({
    data: { organizationId: org.id, locationId: location.id, resourceTypeId: resourceType.id, name: "Chair 1" },
  });
  const resource2 = await prisma.resource.create({
    data: { organizationId: org.id, locationId: location.id, resourceTypeId: resourceType.id, name: "Chair 2" },
  });
  const service = await prisma.service.create({
    data: {
      organizationId: org.id,
      name: { en: "Pedicure", es: "Pedicura" },
      durationMin: 60,
      bufferAfterMin: 0,
      priceCents: 4000,
      resourceTypeId: resourceType.id,
    },
  });
  const customer = await prisma.customer.create({
    data: { organizationId: org.id, phoneE164: "+13055550100", name: "Ana", locale: "es", createdVia: "ONLINE" },
  });
  return {
    orgId: org.id,
    locationId: location.id,
    staffA: staffA.id,
    staffB: staffB.id,
    serviceId: service.id,
    resourceTypeId: resourceType.id,
    resource1: resource1.id,
    resource2: resource2.id,
    customerId: customer.id,
  };
}

export interface SegmentInput {
  staffUserId: string;
  startsAt: string; // "HH:MM" on 2026-12-01 UTC
  endsAt: string;
  blockEndsAt?: string;
  resourceId?: string | null;
  occupies?: boolean;
}

const at = (hhmm: string) => new Date(`2026-12-01T${hhmm}:00.000Z`);

/** Creates a BOOKED appointment with one segment. */
export function bookSegment(prisma: PrismaClient, f: Fixture, s: SegmentInput) {
  const startsAt = at(s.startsAt);
  const endsAt = at(s.endsAt);
  return prisma.appointment.create({
    data: {
      organizationId: f.orgId,
      locationId: f.locationId,
      customerId: f.customerId,
      status: "BOOKED",
      source: "ONLINE",
      segments: {
        create: {
          organizationId: f.orgId,
          serviceId: f.serviceId,
          staffUserId: s.staffUserId,
          resourceId: s.resourceId ?? null,
          startsAt,
          endsAt,
          blockEndsAt: s.blockEndsAt ? at(s.blockEndsAt) : endsAt,
          durationMin: Math.round((endsAt.getTime() - startsAt.getTime()) / 60_000),
          priceCents: 4000,
          occupies: s.occupies ?? true,
        },
      },
    },
  });
}

export interface CreateStaffOpts {
  email: string;
  role: StaffRole;
  password?: string;
  totpSecret?: string;
  active?: boolean;
  canLogin?: boolean;
}

/**
 * Creates a staff user (email lowercased). `password` is hashed with argon2id;
 * `totpSecret` is encrypted with the test `Encryptor` (same key as the app's
 * `testEnv()`) and marks the user as enrolled. `canLogin` defaults to true.
 */
export async function createStaff(prisma: PrismaClient, f: Fixture, opts: CreateStaffOpts): Promise<{ id: string }> {
  const env = testEnv();
  const encryptor = new Encryptor({ keyId: env.DATA_ENCRYPTION_KEY_ID, keyB64: env.DATA_ENCRYPTION_KEY });
  return prisma.staffUser.create({
    data: {
      organizationId: f.orgId,
      email: opts.email.toLowerCase(),
      role: opts.role,
      locale: "en",
      active: opts.active ?? true,
      canLogin: opts.canLogin ?? true,
      passwordHash: opts.password ? await hashPassword(opts.password) : null,
      totpSecretEnc: opts.totpSecret ? encryptor.encrypt(opts.totpSecret) : null,
      totpEnrolledAt: opts.totpSecret ? new Date() : null,
    },
    select: { id: true },
  });
}

/**
 * Creates a staff user who can log in and is enrolled in TOTP, and returns an
 * access token for them issued by the app's own `TokenService`. `email`
 * defaults to a unique `<role>-<uuid>@test.dev`.
 */
export async function staffSession(
  app: INestApplication,
  prisma: PrismaClient,
  f: Fixture,
  role: StaffRole,
  email?: string,
): Promise<{ id: string; token: string }> {
  const { id } = await createStaff(prisma, f, {
    email: email ?? `${role.toLowerCase()}-${randomUUID()}@test.dev`,
    role,
    canLogin: true,
    totpSecret: generateTotpSecret(),
  });
  const { token } = await app.get(TokenService).issueAccess({ sub: id, typ: "staff", org: f.orgId, role });
  return { id, token };
}

/**
 * An access token for an existing customer (default `f.customerId`), issued by
 * the app's own `TokenService`.
 */
export async function customerSession(
  app: INestApplication,
  f: Fixture,
  customerId: string = f.customerId,
): Promise<{ id: string; token: string }> {
  const { token } = await app
    .get(TokenService)
    .issueAccess({ sub: customerId, typ: "customer", org: f.orgId, role: "CUSTOMER" });
  return { id: customerId, token };
}

/**
 * A `Clock` pinned at `ms` until `set` moves it. Apps that book pass
 * `override: (b) => b.overrideProvider(CLOCK).useValue(clock)`.
 */
export function fixedClock(ms: number): Clock & { set(ms: number): void } {
  let current = ms;
  return {
    now: () => current,
    set: (next: number) => {
      current = next;
    },
  };
}

/** Monday 2026-11-30 07:00 in New York (EST, UTC-5). */
export const BOOKING_NOW = Date.parse("2026-11-30T12:00:00.000Z");
/** Tuesday; 09:00 local = 14:00Z. */
export const BOOKING_DATE = "2026-12-01";

export type BookingFixture = Fixture & { maniId: string; pediId: string };

/**
 * `seedFixture` plus what booking needs: location open Mon-Sat 09:00-19:00;
 * Pedicure (`serviceId` = `pediId`, 60 min, chair) parallelizable; Manicure
 * (`maniId`, 30 min + 5 buffer, 2500, parallelizable, no resource); `staffA`
 * "Alex" and `staffB` "Blair" bookable online at the location, working
 * Tue-Sat 09:00-19:00, doing both services. Location settings stay `{}`
 * (defaults).
 */
export async function seedBookingFixture(prisma: PrismaClient): Promise<BookingFixture> {
  const f = await seedFixture(prisma);
  const opens = wallToTime("09:00");
  const closes = wallToTime("19:00");
  await prisma.locationHours.createMany({
    data: [1, 2, 3, 4, 5, 6].map((weekday) => ({ locationId: f.locationId, weekday, opens, closes })),
  });
  await prisma.service.update({ where: { id: f.serviceId }, data: { parallelizable: true } });
  const mani = await prisma.service.create({
    data: {
      organizationId: f.orgId,
      name: { en: "Manicure", es: "Manicura" },
      durationMin: 30,
      bufferAfterMin: 5,
      priceCents: 2500,
      parallelizable: true,
    },
  });
  const staff = [
    { id: f.staffA, displayName: "Alex" },
    { id: f.staffB, displayName: "Blair" },
  ];
  for (const s of staff) {
    await prisma.employeeProfile.create({
      data: { staffUserId: s.id, displayName: s.displayName, bookableOnline: true },
    });
    await prisma.staffLocation.create({ data: { staffUserId: s.id, locationId: f.locationId } });
    await prisma.workingHours.createMany({
      data: [2, 3, 4, 5, 6].map((weekday) => ({
        organizationId: f.orgId,
        staffUserId: s.id,
        locationId: f.locationId,
        weekday,
        startTime: opens,
        endTime: closes,
      })),
    });
    await prisma.employeeService.createMany({
      data: [f.serviceId, mani.id].map((serviceId) => ({ staffUserId: s.id, serviceId })),
    });
  }
  return { ...f, maniId: mani.id, pediId: f.serviceId };
}
