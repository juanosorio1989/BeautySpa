import { describe, expect, it } from "vitest";
import robots from "./robots";
import sitemap from "./sitemap";

describe("robots", () => {
  it("disallows /*/book/, /*/me, /*/login", () => {
    const rules = robots().rules;
    const rule = Array.isArray(rules) ? rules[0]! : rules;
    expect(rule.disallow).toEqual(["/*/book/", "/*/me", "/*/login"]);
    expect(rule.allow).toBe("/");
  });
});

describe("sitemap", () => {
  it("lists 8 urls (4 pages x 2 locales)", () => {
    const urls = sitemap().map((e) => e.url);
    expect(urls).toHaveLength(8);
    expect(new Set(urls).size).toBe(8);
    expect(urls.filter((u) => u.includes("/es"))).toHaveLength(4);
  });
});
