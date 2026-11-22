import type { Queue } from "bullmq";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DELIVER_JOB_OPTIONS,
  enqueueBounded,
  ENQUEUE_TIMEOUT_MS,
  SEND_JOB_OPTIONS,
  sendJobId,
  type SendJob,
} from "./queue-names.js";

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

describe("enqueueBounded", () => {
  afterEach(() => vi.useRealTimers());
  const queueWith = (add: (...args: unknown[]) => Promise<unknown>) => ({ add: vi.fn(add) }) as unknown as Queue;

  it("passes name, data and options to add and resolves with the job, clearing its timer", async () => {
    vi.useFakeTimers();
    const queue = queueWith(() => Promise.resolve({ id: "j1" }));
    await expect(enqueueBounded(queue, "send", job, { jobId: "x" })).resolves.toEqual({ id: "j1" });
    expect(queue.add).toHaveBeenCalledWith("send", job, { jobId: "x" });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("rejects with the add error, clearing its timer", async () => {
    vi.useFakeTimers();
    const queue = queueWith(() => Promise.reject(new Error("boom")));
    await expect(enqueueBounded(queue, "send", job)).rejects.toThrow("boom");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("rejects when add throws synchronously, clearing its timer", async () => {
    vi.useFakeTimers();
    const queue = {
      add: () => {
        throw new Error("sync");
      },
    } as unknown as Queue;
    await expect(enqueueBounded(queue, "send", job)).rejects.toThrow("sync");
    expect(vi.getTimerCount()).toBe(0);
  });

  it(`rejects with QUEUE_TIMEOUT when add has not settled after ${ENQUEUE_TIMEOUT_MS} ms`, async () => {
    vi.useFakeTimers();
    const queue = queueWith(() => new Promise(() => undefined));
    const result = enqueueBounded(queue, "send", job);
    const assertion = expect(result).rejects.toThrow("QUEUE_TIMEOUT");
    await vi.advanceTimersByTimeAsync(ENQUEUE_TIMEOUT_MS - 1);
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    await assertion;
    expect(ENQUEUE_TIMEOUT_MS).toBe(2000);
  });
});
