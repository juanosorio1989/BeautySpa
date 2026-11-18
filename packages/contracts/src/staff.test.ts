import { describe, expect, it } from "vitest";
import { EmployeeCreateSchema, TimeOffInputSchema, TimeOffQuerySchema } from "./staff";

const id = "11111111-1111-4111-8111-111111111111";
const base = { role: "EMPLOYEE", locale: "en" };
const profile = { displayName: "Ana" };

const firstPath = (r: { success: boolean; error?: { issues: { path: (string | number)[] }[] } }) =>
  r.error?.issues[0]?.path;

describe("EmployeeCreateSchema", () => {
  it("canLogin requires email", () => {
    const r = EmployeeCreateSchema.safeParse({ ...base, canLogin: true });
    expect(r.success).toBe(false);
    expect(firstPath(r)).toEqual(["email"]);
  });
  it("sendInvite requires canLogin", () => {
    const r = EmployeeCreateSchema.safeParse({ ...base, sendInvite: true, canLogin: false });
    expect(r.success).toBe(false);
    expect(firstPath(r)).toEqual(["sendInvite"]);
  });
  it("serviceIds require profile", () => {
    const r = EmployeeCreateSchema.safeParse({ ...base, serviceIds: [id], profile: null });
    expect(r.success).toBe(false);
    expect(firstPath(r)).toEqual(["serviceIds"]);
  });
  it("rejects non-https photoUrl", () => {
    const r = EmployeeCreateSchema.safeParse({ ...base, profile: { ...profile, photoUrl: "http://x.dev/a.jpg" } });
    expect(r.success).toBe(false);
  });
  it("normalizes email", () => {
    expect(EmployeeCreateSchema.parse({ ...base, email: " Ana@Salon.COM " }).email).toBe("ana@salon.com");
  });
  it("rejects duplicate serviceIds", () => {
    expect(EmployeeCreateSchema.safeParse({ ...base, profile, serviceIds: [id, id] }).success).toBe(false);
  });
});

describe("TimeOff", () => {
  const t = { employeeId: id, kind: "VACATION" };
  it("rejects endsAt == startsAt", () => {
    const r = TimeOffInputSchema.safeParse({ ...t, startsAt: "2026-01-01T00:00:00Z", endsAt: "2026-01-01T00:00:00Z" });
    expect(r.success).toBe(false);
    expect(firstPath(r)).toEqual(["endsAt"]);
  });
  it("rejects 367-day span", () => {
    expect(
      TimeOffInputSchema.safeParse({ ...t, startsAt: "2026-01-01T00:00:00Z", endsAt: "2027-01-03T00:00:00Z" }).success,
    ).toBe(false);
  });
  it("accepts 366-day span", () => {
    expect(
      TimeOffInputSchema.safeParse({ ...t, startsAt: "2026-01-01T00:00:00Z", endsAt: "2027-01-02T00:00:00Z" }).success,
    ).toBe(true);
  });
  it("query rejects from > to", () => {
    expect(TimeOffQuerySchema.safeParse({ from: "2026-02-01T00:00:00Z", to: "2026-01-01T00:00:00Z" }).success).toBe(false);
  });
});
