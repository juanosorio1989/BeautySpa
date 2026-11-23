import { describe, expect, it } from "vitest";
import { buildIcs, type IcsEvent } from "./ics.js";

const event: IcsEvent = {
  uid: "appointment-abc123@beautyspa",
  sequence: 2,
  dtstamp: new Date("2026-11-22T12:00:00Z"),
  start: new Date("2026-12-01T15:00:00Z"),
  end: new Date("2026-12-01T16:30:00Z"),
  summary: "Haircut - Glow Spa",
  location: "1 Main St",
  description: "With Ana",
  url: "https://x.test/m/t",
  status: "CONFIRMED",
};

describe("buildIcs", () => {
  it("REQUEST golden file", () => {
    const out = buildIcs(event, {
      method: "REQUEST",
      organizerEmail: "hi@glow.test",
      attendeeEmail: "c@x.test",
    });
    const expected = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//BeautySpa//Booking//EN",
      "CALSCALE:GREGORIAN",
      "METHOD:REQUEST",
      "BEGIN:VEVENT",
      "UID:appointment-abc123@beautyspa",
      "SEQUENCE:2",
      "DTSTAMP:20261122T120000Z",
      "DTSTART:20261201T150000Z",
      "DTEND:20261201T163000Z",
      "SUMMARY:Haircut - Glow Spa",
      "LOCATION:1 Main St",
      "DESCRIPTION:With Ana\\nhttps://x.test/m/t",
      "ORGANIZER:mailto:hi@glow.test",
      "ATTENDEE;RSVP=FALSE:mailto:c@x.test",
      "STATUS:CONFIRMED",
      "END:VEVENT",
      "END:VCALENDAR",
      "",
    ].join("\r\n");
    expect(out).toBe(expected);
  });

  it("CANCEL has STATUS:CANCELLED and METHOD:CANCEL", () => {
    const out = buildIcs(
      { ...event, status: "CANCELLED" },
      { method: "CANCEL", organizerEmail: "hi@glow.test", attendeeEmail: "c@x.test" },
    );
    expect(out).toContain("METHOD:CANCEL\r\n");
    expect(out).toContain("STATUS:CANCELLED\r\n");
    expect(out).toContain("ORGANIZER:mailto:hi@glow.test\r\n");
    expect(out).toContain("ATTENDEE;RSVP=FALSE:mailto:c@x.test\r\n");
  });

  it("REQUEST and CANCEL require an organizer", () => {
    expect(() => buildIcs(event, { method: "REQUEST", attendeeEmail: "c@x.test" })).toThrow(/organizer/i);
    expect(() => buildIcs({ ...event, status: "CANCELLED" }, { method: "CANCEL" })).toThrow(/organizer/i);
    expect(() => buildIcs(event, { method: "PUBLISH" })).not.toThrow();
  });

  it("rejects CR or LF in organizer or attendee", () => {
    for (const bad of ["a@x.test\r\nATTENDEE:mailto:evil@x.test", "a@x.test\nX", "a@x.test\rX"]) {
      expect(() => buildIcs(event, { method: "REQUEST", organizerEmail: bad })).toThrow();
      expect(() =>
        buildIcs(event, { method: "REQUEST", organizerEmail: "hi@glow.test", attendeeEmail: bad }),
      ).toThrow();
    }
  });

  it("PUBLISH has no ORGANIZER or ATTENDEE", () => {
    const out = buildIcs(event, {
      method: "PUBLISH",
      organizerEmail: "hi@glow.test",
      attendeeEmail: "c@x.test",
    });
    expect(out).not.toContain("ORGANIZER");
    expect(out).not.toContain("ATTENDEE");
  });

  it("ics escapes text", () => {
    const out = buildIcs({ ...event, summary: "a,b;c\\d\ne" }, { method: "PUBLISH" });
    expect(out).toContain("SUMMARY:a\\,b\\;c\\\\d\\ne\r\n");
  });

  it("folds lines over 75 octets", () => {
    const out = buildIcs({ ...event, description: "ñ".repeat(120) }, { method: "PUBLISH" });
    const lines = out.split("\r\n");
    for (const l of lines) expect(Buffer.byteLength(l, "utf8")).toBeLessThanOrEqual(75);
    const i = lines.findIndex((l) => l.startsWith("DESCRIPTION:"));
    expect(lines[i + 1]?.startsWith(" ")).toBe(true);
    expect(lines[i + 1]?.startsWith("  ")).toBe(false);
    // unfolding restores the original
    const unfolded = out.replace(/\r\n /g, "");
    expect(unfolded).toContain("DESCRIPTION:" + "ñ".repeat(120) + "\\nhttps://x.test/m/t");
  });
});
