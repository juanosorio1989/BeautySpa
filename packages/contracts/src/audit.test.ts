import { describe, expect, it } from "vitest";
import { AuditQuerySchema } from "./audit";

describe("AuditQuerySchema", () => {
  it("coerces limit and defaults to 50", () => {
    expect(AuditQuerySchema.parse({ limit: "20" }).limit).toBe(20);
    expect(AuditQuerySchema.parse({}).limit).toBe(50);
    expect(AuditQuerySchema.safeParse({ limit: "0" }).success).toBe(false);
  });
});
