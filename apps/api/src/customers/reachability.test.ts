import { describe, expect, it } from "vitest";
import { consentsFromRows, reachableIds } from "./reachability.js";

const consent = (customerId: string, channel: "EMAIL" | "PUSH" | "SMS", granted = true, n = 0) => ({
  customerId,
  channel,
  granted,
  changedAt: new Date(1_000 + n),
  id: `c${n}`,
});

const reach = (rows: ReturnType<typeof consent>[], email: Set<string>, push: Set<string>) =>
  reachableIds(["a"], consentsFromRows(["a"], rows), email, push);

describe("reachableIds", () => {
  it("email consent with an email is reachable", () => {
    const out = reach([consent("a", "EMAIL")], new Set(["a"]), new Set());
    expect([...out]).toEqual(["a"]);
  });

  it("email consent without an email is not", () => {
    expect(reach([consent("a", "EMAIL")], new Set(), new Set()).size).toBe(0);
  });

  it("push consent with a subscription is reachable, without is not", () => {
    expect(reach([consent("a", "PUSH")], new Set(), new Set(["a"])).has("a")).toBe(true);
    expect(reach([consent("a", "PUSH")], new Set(), new Set()).has("a")).toBe(false);
  });

  it("no consents, SMS only, or a later revoke is not reachable", () => {
    expect(reach([], new Set(["a"]), new Set(["a"])).size).toBe(0);
    expect(reach([consent("a", "SMS")], new Set(["a"]), new Set(["a"])).size).toBe(0);
    const revoked = [consent("a", "EMAIL", true, 1), consent("a", "EMAIL", false, 2)];
    expect(reach(revoked, new Set(["a"]), new Set()).size).toBe(0);
  });
});
