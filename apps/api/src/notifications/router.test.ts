import { describe, expect, it } from "vitest";
import type { Consents } from "@beautyspa/contracts";
import { selectChannels } from "./router.js";

const none: Consents = { WHATSAPP: false, SMS: false, EMAIL: false, PUSH: false };
const all: Consents = { WHATSAPP: true, SMS: true, EMAIL: true, PUSH: true };

describe("selectChannels", () => {
  it("selects consented reachable channels", () => {
    expect(selectChannels(all, { email: true, push: true })).toEqual(["EMAIL", "PUSH"]);
    expect(selectChannels({ ...none, EMAIL: true }, { email: true, push: true })).toEqual(["EMAIL"]);
    expect(selectChannels({ ...none, PUSH: true }, { email: true, push: true })).toEqual(["PUSH"]);
    expect(selectChannels(none, { email: true, push: true })).toEqual([]);
  });

  it("email consent without email skips EMAIL", () => {
    expect(selectChannels(all, { email: false, push: true })).toEqual(["PUSH"]);
    expect(selectChannels(all, { email: false, push: false })).toEqual([]);
    expect(selectChannels({ ...none, PUSH: true }, { email: true, push: false })).toEqual([]);
  });

  it("only restricts channels", () => {
    expect(selectChannels(all, { email: true, push: true }, ["EMAIL"])).toEqual(["EMAIL"]);
    expect(selectChannels(all, { email: true, push: true }, ["PUSH"])).toEqual(["PUSH"]);
    expect(selectChannels({ ...none, EMAIL: true }, { email: true, push: true }, ["PUSH"])).toEqual([]);
    expect(selectChannels(all, { email: true, push: true }, [])).toEqual([]);
  });

  it("never selects SMS or WHATSAPP", () => {
    const out = selectChannels({ ...none, SMS: true, WHATSAPP: true }, { email: true, push: true });
    expect(out).toEqual([]);
    const widened = selectChannels(all, { email: true, push: true }, ["SMS", "WHATSAPP"] as never);
    expect(widened).toEqual([]);
  });
});
