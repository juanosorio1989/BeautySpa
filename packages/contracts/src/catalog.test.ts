import { describe, expect, it } from "vitest";
import { ServiceInputSchema, ServiceUpdateSchema, CategoryUpdateSchema } from "./catalog";

const id = "11111111-1111-4111-8111-111111111111";
const id2 = "22222222-2222-4222-8222-222222222222";
const base = { categoryId: null, name: { en: "Cut", es: "Corte" }, durationMin: 30, priceCents: 1000 };

describe("ServiceInputSchema", () => {
  it("applies defaults", () => {
    const s = ServiceInputSchema.parse(base);
    expect(s.bufferAfterMin).toBe(0);
    expect(s.onlineBookable).toBe(true);
    expect(s.levelPrices).toEqual([]);
    expect(s.description).toBeNull();
  });
  it("rejects durationMin 4", () => {
    expect(ServiceInputSchema.safeParse({ ...base, durationMin: 4 }).success).toBe(false);
  });
  it("rejects duplicate levelId with path levelPrices.1.levelId", () => {
    const lp = { levelId: id, durationMin: 30, priceCents: 1000 };
    const r = ServiceInputSchema.safeParse({ ...base, levelPrices: [lp, { ...lp }, { ...lp, levelId: id2 }] });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]?.path).toEqual(["levelPrices", 1, "levelId"]);
  });
});

describe("update schemas", () => {
  it("rejects empty update", () => {
    expect(ServiceUpdateSchema.safeParse({}).success).toBe(false);
    expect(CategoryUpdateSchema.safeParse({}).success).toBe(false);
  });
  it("does not apply defaults", () => {
    expect(ServiceUpdateSchema.parse({ durationMin: 45 })).toEqual({ durationMin: 45 });
  });
});
