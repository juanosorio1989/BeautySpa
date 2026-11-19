import { describe, expect, it } from "vitest";
import { ana, bea, carla, chair1, chair2, dani, gel, haircut, location, mani, MON, pedi } from "../test/fixtures";
import { MAX_NODES_PER_START, planAt, prepare } from "./plan";
import type { Context } from "./types";

const ctx: Context = {
  location,
  services: [mani, pedi, gel, haircut],
  employees: [ana, bea, carla, dani],
  resources: [chair1, chair2],
  busy: [],
  mode: "STAFF",
  now: Date.parse("2026-12-06T12:00:00Z"),
};
const p = prepare(ctx, MON);
const t = p.dayStart + 9 * 3_600_000 + 5 * 3_600_000; // 09:00 NY (14:00Z)

describe("planAt node budget", () => {
  it("exports a default budget", () => {
    expect(MAX_NODES_PER_START).toBe(5000);
  });
  it("finds a plan with the default budget", () => {
    expect(
      planAt(
        p,
        [mani, pedi],
        [
          [ana, bea],
          [ana, bea],
        ],
        t,
        "parallel",
      ),
    ).not.toBeNull();
  });
  it("yields no plan when the budget is exhausted", () => {
    expect(
      planAt(
        p,
        [mani, pedi],
        [
          [ana, bea],
          [ana, bea],
        ],
        t,
        "parallel",
        1,
      ),
    ).toBeNull();
  });
});
