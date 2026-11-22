import { Logger } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { ConsoleMailer } from "./console.mailer.js";

describe("ConsoleMailer", () => {
  it("logs subject and attachment names, never the body", async () => {
    const log = vi.spyOn(Logger.prototype, "log").mockImplementation(() => undefined);
    const out = await new ConsoleMailer().send({
      to: "ana@salon.com",
      subject: "Hello",
      text: "secret-text-body",
      html: "<p>secret-html-body</p>",
      attachments: [{ filename: "a.ics", content: "secret-ics", contentType: "text/calendar" }],
    });
    const logged = log.mock.calls.map((c) => String(c[0])).join("\n");
    expect(logged).toContain("Hello");
    expect(logged).toContain("a.ics");
    expect(logged).not.toContain("secret-text-body");
    expect(logged).not.toContain("secret-html-body");
    expect(logged).not.toContain("secret-ics");
    expect(out).toEqual({});
    log.mockRestore();
  });
});
