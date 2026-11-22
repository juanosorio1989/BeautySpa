import { describe, expect, it } from "vitest";
import { en, es } from "./index";

function keys(value: unknown, prefix = ""): string[] {
  if (typeof value !== "object" || value === null) return [prefix];
  const entries = Object.entries(value);
  if (entries.length === 0) return [prefix];
  return entries.flatMap(([k, v]) => keys(v, prefix ? `${prefix}.${k}` : k));
}

describe("catalogs", () => {
  it("en and es have the same keys", () => {
    expect(keys(es).sort()).toEqual(keys(en).sort());
  });

  it("has no empty strings", () => {
    const empty = (v: unknown): boolean =>
      typeof v === "string" ? v.trim() === "" : typeof v === "object" && v !== null && Object.values(v).some(empty);
    expect(empty(en)).toBe(false);
    expect(empty(es)).toBe(false);
  });
});
