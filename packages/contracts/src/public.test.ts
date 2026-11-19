import { describe, expect, it } from "vitest";
import { PublicServicesResponseSchema } from "./public";

describe("PublicServicesResponseSchema", () => {
  it("parses an empty response", () => {
    expect(PublicServicesResponseSchema.parse({ categories: [], services: [] })).toEqual({
      categories: [],
      services: [],
    });
  });
});
