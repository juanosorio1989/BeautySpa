import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { CustomerExport, CustomerNotes } from "@beautyspa/contracts";
import { CLOCK } from "../../../src/common/clock.js";
import { Encryptor } from "../../../src/auth/crypto/encryption.js";
import { TokenService } from "../../../src/auth/token.service.js";
import { createIntegrationApp, resetState, resetTenancyCache } from "../app.js";
import {
  BOOKING_NOW,
  customerSession,
  fixedClock,
  seedBookingFixture,
  staffSession,
  type BookingFixture,
} from "../helpers.js";

const NOTE = "Prefers unscented products; allergic to latex";

describe("staff private customer notes", () => {
  let ctx: Awaited<ReturnType<typeof createIntegrationApp>>;
  let f: BookingFixture;
  let reception: { id: string; token: string };
  const clock = fixedClock(BOOKING_NOW);

  const http = () => request(ctx.app.getHttpServer());
  const getNotes = (id: string, bearer = reception.token) =>
    http().get(`/v1/staff/customers/${id}/notes`).set("Authorization", `Bearer ${bearer}`);
  const putNotes = (id: string, body: unknown, bearer = reception.token) =>
    http()
      .put(`/v1/staff/customers/${id}/notes`)
      .set("Authorization", `Bearer ${bearer}`)
      .send(body as object);
  const employeeToken = async (staffUserId: string) =>
    (await ctx.app.get(TokenService).issueAccess({ sub: staffUserId, typ: "staff", org: f.orgId, role: "EMPLOYEE" }))
      .token;
  const noteAudits = () =>
    ctx.prisma.auditLog.findMany({ where: { organizationId: f.orgId, action: "customer.notes" } });

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
    reception = await staffSession(ctx.app, ctx.prisma, f, "RECEPTION");
  });

  it("answers all-null for a customer without notes", async () => {
    const res = await getNotes(f.customerId);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ notes: null, updatedAt: null, updatedBy: null });
  });

  it("stores the text encrypted and returns it with updatedAt and updatedBy", async () => {
    const put = await putNotes(f.customerId, { notes: `  ${NOTE}  ` });
    expect(put.status).toBe(200);
    const staff = await ctx.prisma.staffUser.findUniqueOrThrow({ where: { id: reception.id } });
    const expected: CustomerNotes = {
      notes: NOTE,
      updatedAt: new Date(BOOKING_NOW).toISOString(),
      updatedBy: { id: reception.id, name: staff.email! },
    };
    expect(put.body).toEqual(expected);

    const got = await getNotes(f.customerId);
    expect(got.status).toBe(200);
    expect(got.body).toEqual(expected);

    const row = await ctx.prisma.customer.findUniqueOrThrow({ where: { id: f.customerId } });
    expect(row.privateNotesEnc).toBeTruthy();
    expect(row.privateNotesEnc).not.toContain(NOTE);
    expect(row.privateNotesEnc).not.toContain("latex");
    expect(ctx.app.get(Encryptor).decrypt(row.privateNotesEnc!)).toBe(NOTE);
    expect(row.privateNotesUpdatedAt).toEqual(new Date(BOOKING_NOW));
    expect(row.privateNotesUpdatedBy).toBe(reception.id);
  });

  it("uses the employee profile display name for updatedBy when there is one", async () => {
    const owner = await staffSession(ctx.app, ctx.prisma, f, "OWNER");
    await ctx.prisma.employeeProfile.create({ data: { staffUserId: owner.id, displayName: "Marta" } });
    const res = await putNotes(f.customerId, { notes: NOTE }, owner.token);
    expect(res.status).toBe(200);
    expect((res.body as CustomerNotes).updatedBy).toEqual({ id: owner.id, name: "Marta" });
  });

  it("keeps the note but drops the author when the staff user is deleted (ON DELETE SET NULL)", async () => {
    const owner = await staffSession(ctx.app, ctx.prisma, f, "OWNER");
    expect((await putNotes(f.customerId, { notes: NOTE }, owner.token)).status).toBe(200);
    await ctx.prisma.$executeRaw`DELETE FROM staff_user WHERE id = ${owner.id}::uuid`;
    const res = await getNotes(f.customerId);
    expect(res.body).toEqual({ notes: NOTE, updatedAt: new Date(BOOKING_NOW).toISOString(), updatedBy: null });
  });

  it("stores blank text as null and clears the ciphertext", async () => {
    expect((await putNotes(f.customerId, { notes: NOTE })).status).toBe(200);
    clock.set(BOOKING_NOW + 60_000);
    const res = await putNotes(f.customerId, { notes: "   " });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      notes: null,
      updatedAt: new Date(BOOKING_NOW + 60_000).toISOString(),
      updatedBy: expect.objectContaining({ id: reception.id }),
    });
    const row = await ctx.prisma.customer.findUniqueOrThrow({ where: { id: f.customerId } });
    expect(row.privateNotesEnc).toBeNull();
    expect((await putNotes(f.customerId, { notes: null })).status).toBe(200);
  });

  it("accepts 2,000 characters and rejects 2,001 or a missing field with 400", async () => {
    expect((await putNotes(f.customerId, { notes: "a".repeat(2000) })).status).toBe(200);
    const tooLong = await putNotes(f.customerId, { notes: "b".repeat(2001) });
    expect(tooLong.status).toBe(400);
    expect((await putNotes(f.customerId, {})).status).toBe(400);
    const row = await ctx.prisma.customer.findUniqueOrThrow({ where: { id: f.customerId } });
    expect(ctx.app.get(Encryptor).decrypt(row.privateNotesEnc!)).toBe("a".repeat(2000));
  });

  it("answers 404 for another organization's customer or a deleted one, 403 for an EMPLOYEE", async () => {
    const otherOrg = await ctx.prisma.organization.create({
      data: { name: "Other", slug: "other-org", defaultLocale: "en" },
    });
    const foreign = await ctx.prisma.customer.create({
      data: { organizationId: otherOrg.id, phoneE164: "+13055550177", name: "Zed", locale: "en", createdVia: "ONLINE" },
    });
    expect((await getNotes(foreign.id)).status).toBe(404);
    expect((await putNotes(foreign.id, { notes: NOTE })).status).toBe(404);
    const untouched = await ctx.prisma.customer.findUniqueOrThrow({ where: { id: foreign.id } });
    expect(untouched.privateNotesEnc).toBeNull();

    const employee = await employeeToken(f.staffA);
    expect((await getNotes(f.customerId, employee)).status).toBe(403);
    expect((await putNotes(f.customerId, { notes: NOTE }, employee)).status).toBe(403);

    await ctx.prisma.customer.update({ where: { id: f.customerId }, data: { deletedAt: new Date() } });
    expect((await getNotes(f.customerId)).status).toBe(404);
    expect((await putNotes(f.customerId, { notes: NOTE })).status).toBe(404);
    expect(await noteAudits()).toHaveLength(0);
  });

  it("audits customer.notes with { changed: true } and never the text", async () => {
    expect((await putNotes(f.customerId, { notes: NOTE })).status).toBe(200);
    const audits = await noteAudits();
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      actorType: "STAFF",
      actorId: reception.id,
      entity: "customer",
      entityId: f.customerId,
      before: { changed: true },
      after: { changed: true },
    });
    const leaks = await ctx.prisma.$queryRaw<{ n: bigint }[]>`
      SELECT count(*) AS n FROM audit_log
      WHERE organization_id = ${f.orgId}::uuid
        AND (coalesce(before::text, '') LIKE '%latex%' OR coalesce(after::text, '') LIKE '%latex%')`;
    expect(Number(leaks[0]!.n)).toBe(0);
  });

  it("leaves private notes out of the customer's own export", async () => {
    expect((await putNotes(f.customerId, { notes: NOTE })).status).toBe(200);
    const customer = await customerSession(ctx.app, f);
    const res = await http().get("/v1/me/export").set("Authorization", `Bearer ${customer.token}`);
    expect(res.status).toBe(200);
    const text = JSON.stringify(res.body as CustomerExport);
    expect(text).not.toContain("latex");
    expect(text).not.toMatch(/privateNotes|private_notes/);
  });
});
