import { describe, expect, it } from "vitest";
import { DELIVER_JOB_OPTIONS, SEND_JOB_OPTIONS, sendJobId, type SendJob } from "./queue-names.js";

const job: SendJob = {
  appointmentId: "01934b6e-0000-7000-8000-000000000001",
  templateKey: "appointment.reminder_24h",
  manageVersion: 2,
};

describe("sendJobId", () => {
  it("is send|<appointmentId>|<templateKey>|<manageVersion>", () => {
    expect(sendJobId(job)).toBe("send|01934b6e-0000-7000-8000-000000000001|appointment.reminder_24h|2");
  });

  it("appends |<suffix> when given", () => {
    expect(sendJobId(job, "grant|EMAIL|42")).toBe(
      "send|01934b6e-0000-7000-8000-000000000001|appointment.reminder_24h|2|grant|EMAIL|42",
    );
  });

  it('never contains ":"', () => {
    expect(sendJobId(job)).not.toContain(":");
    expect(sendJobId(job, "grant|PUSH|7")).not.toContain(":");
  });
});

describe("job options", () => {
  it("send retries 3 times from 10 s and deliver 5 times from 30 s; completed kept 1 day, failed 7 days", () => {
    expect(SEND_JOB_OPTIONS).toEqual({
      attempts: 3,
      backoff: { type: "exponential", delay: 10_000 },
      removeOnComplete: { age: 86_400 },
      removeOnFail: { age: 604_800 },
    });
    expect(DELIVER_JOB_OPTIONS).toEqual({
      attempts: 5,
      backoff: { type: "exponential", delay: 30_000 },
      removeOnComplete: { age: 86_400 },
      removeOnFail: { age: 604_800 },
    });
  });
});
