import { describe, expect, it } from "vitest";
import { ApiError } from "./errors";
import type { FetchLike } from "./fetch";
import { createApiClient } from "./client";
import { MemoryTokenStore } from "./token-store";

type Call = { url: string; init: Parameters<FetchLike>[1] };
type Reply = { status: number; body?: unknown };

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const T = "2026-12-01T10:00:00.000Z";
const segment = {
  serviceId: U(1),
  employeeId: U(2),
  resourceId: null,
  startsAt: T,
  endsAt: T,
  blockEndsAt: T,
  durationMin: 30,
  priceCents: 5000,
};
const appointment = {
  id: U(3),
  locationId: U(4),
  status: "BOOKED",
  source: "ONLINE",
  startsAt: T,
  endsAt: T,
  totalPriceCents: 5000,
  notes: null,
  segments: [{ ...segment, id: U(5) }],
  confirmedByCustomerAt: null,
  cancelledAt: null,
  cancelReason: null,
  createdAt: T,
};
const me = {
  id: U(6),
  phoneE164: "+521234567890",
  name: null,
  email: null,
  locale: "en",
  consents: { WHATSAPP: false, SMS: false, EMAIL: false, PUSH: false },
};

function setup(reply: Reply, token: string | null = "tok") {
  const calls: Call[] = [];
  const fetch: FetchLike = (url, init) => {
    calls.push({ url, init });
    return Promise.resolve({
      status: reply.status,
      headers: { get: () => null },
      text: () => Promise.resolve(reply.body === undefined ? "" : JSON.stringify(reply.body)),
    });
  };
  const store = new MemoryTokenStore();
  store.setAccessToken(token);
  const api = createApiClient({ baseUrl: "http://x", fetch, tokenStore: store, transport: "cookie" });
  return { api, calls };
}

describe("public", () => {
  it("locations is GET without bearer", async () => {
    const { api, calls } = setup({ status: 200, body: [] });
    await expect(api.public.locations()).resolves.toEqual([]);
    expect(calls[0]!.init.method).toBe("GET");
    expect(calls[0]!.url).toBe("http://x/v1/public/locations");
    expect(calls[0]!.init.headers.authorization).toBeUndefined();
  });

  it("services adds locationId only when given", async () => {
    const { api, calls } = setup({ status: 200, body: { categories: [], services: [] } });
    await api.public.services();
    await api.public.services({ locationId: U(4) });
    expect(calls[0]!.url).toBe("http://x/v1/public/services");
    expect(calls[1]!.url).toBe(`http://x/v1/public/services?locationId=${U(4)}`);
  });

  it("employees is GET /public/employees", async () => {
    const { api, calls } = setup({ status: 200, body: [] });
    await api.public.employees({ locationId: U(4) });
    expect(calls[0]!.url).toBe(`http://x/v1/public/employees?locationId=${U(4)}`);
  });
});

describe("booking", () => {
  it("availability encodes repeated services and optional params", async () => {
    const { api, calls } = setup({ status: 200, body: [] });
    const services = [
      { serviceId: "s1", employeeId: "ANY" as const },
      { serviceId: "s2", employeeId: "e1" },
    ];
    await api.booking.availability({ services, date: "2026-12-01" });
    expect(calls[0]!.url).toBe("http://x/v1/availability?services=s1%3AANY&services=s2%3Ae1&date=2026-12-01");
    expect(calls[0]!.init.headers.authorization).toBe("Bearer tok");
    await api.booking.availability({ services, date: "2026-12-01", locationId: "l1", excludeAppointmentId: "a1" });
    expect(calls[1]!.url).toBe(
      "http://x/v1/availability?locationId=l1&services=s1%3AANY&services=s2%3Ae1&date=2026-12-01&excludeAppointmentId=a1",
    );
  });

  it("availability without a stored token sends no authorization and resolves", async () => {
    const { api, calls } = setup({ status: 200, body: [] }, null);
    await expect(
      api.booking.availability({ services: [{ serviceId: "s1", employeeId: "ANY" }], date: "2026-12-01" }),
    ).resolves.toEqual([]);
    expect(calls[0]!.init.headers.authorization).toBeUndefined();
  });

  it("createHold posts without bearer", async () => {
    const { api, calls } = setup({ status: 200, body: { holdId: U(7), expiresAt: T } });
    await api.booking.createHold({ segments: [segment] });
    expect(JSON.parse(calls[0]!.init.body!)).toEqual({ segments: [segment] });
    expect(calls[0]!.init.method).toBe("POST");
    expect(calls[0]!.url).toBe("http://x/v1/holds");
    expect(calls[0]!.init.headers.authorization).toBeUndefined();
  });

  it("releaseHold sends DELETE /v1/holds/<id> and resolves on 204", async () => {
    const { api, calls } = setup({ status: 204 });
    await expect(api.booking.releaseHold(U(7))).resolves.toBeUndefined();
    expect(calls[0]!.init.method).toBe("DELETE");
    expect(calls[0]!.url).toBe(`http://x/v1/holds/${U(7)}`);
    expect(calls[0]!.init.headers.authorization).toBeUndefined();
  });

  it("book posts /appointments with bearer", async () => {
    const { api, calls } = setup({ status: 200, body: appointment });
    await api.booking.book({ holdId: U(7) });
    expect(JSON.parse(calls[0]!.init.body!)).toEqual({ holdId: U(7) });
    expect(calls[0]!.init.method).toBe("POST");
    expect(calls[0]!.url).toBe("http://x/v1/appointments");
    expect(calls[0]!.init.headers.authorization).toBe("Bearer tok");
  });

  it("a 409 SLOT_TAKEN problem rejects with ApiError code SLOT_TAKEN", async () => {
    const { api } = setup({
      status: 409,
      body: { type: "about:blank", title: "t", status: 409, code: "SLOT_TAKEN" },
    });
    const err = await api.booking.createHold({ segments: [segment] }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).problem.code).toBe("SLOT_TAKEN");
  });
});

describe("me", () => {
  it("get and patch", async () => {
    const { api, calls } = setup({ status: 200, body: me });
    await api.me.get();
    await api.me.patch({ name: "Ana" });
    expect([calls[0]!.init.method, calls[0]!.url]).toEqual(["GET", "http://x/v1/me"]);
    expect([calls[1]!.init.method, calls[1]!.url]).toEqual(["PATCH", "http://x/v1/me"]);
    expect(JSON.parse(calls[1]!.init.body!)).toEqual({ name: "Ana" });
  });

  it("appointments is GET /me/appointments", async () => {
    const { api, calls } = setup({ status: 200, body: { upcoming: [], past: [] } });
    await api.me.appointments();
    expect([calls[0]!.init.method, calls[0]!.url]).toEqual(["GET", "http://x/v1/me/appointments"]);
  });

  it("cancel posts {} when no body, else the body", async () => {
    const { api, calls } = setup({ status: 200, body: appointment });
    await api.me.cancel(U(3));
    await api.me.cancel(U(3), { reason: "busy" });
    expect(calls[0]!.url).toBe(`http://x/v1/me/appointments/${U(3)}/cancel`);
    expect(JSON.parse(calls[0]!.init.body!)).toEqual({});
    expect(JSON.parse(calls[1]!.init.body!)).toEqual({ reason: "busy" });
  });

  it("reschedule posts segments", async () => {
    const { api, calls } = setup({ status: 200, body: appointment });
    await api.me.reschedule(U(3), { segments: [segment] });
    expect([calls[0]!.init.method, calls[0]!.url]).toEqual(["POST", `http://x/v1/me/appointments/${U(3)}/reschedule`]);
  });

  it("repeat posts without a body", async () => {
    const { api, calls } = setup({ status: 200, body: { locationId: U(4), services: [] } });
    await api.me.repeat(U(3));
    expect([calls[0]!.init.method, calls[0]!.url]).toEqual(["POST", `http://x/v1/me/appointments/${U(3)}/repeat`]);
    expect(calls[0]!.init.body).toBeUndefined();
  });

  it("export is GET /me/export", async () => {
    const { api, calls } = setup({ status: 200, body: { customer: me, consentHistory: [], appointments: [] } });
    await api.me.export();
    expect([calls[0]!.init.method, calls[0]!.url]).toEqual(["GET", "http://x/v1/me/export"]);
  });

  it("remove is DELETE /me and resolves on 204", async () => {
    const { api, calls } = setup({ status: 204 });
    await expect(api.me.remove()).resolves.toBeUndefined();
    expect([calls[0]!.init.method, calls[0]!.url]).toEqual(["DELETE", "http://x/v1/me"]);
  });
});

describe("manage and push", () => {
  const view = {
    appointment,
    location: { name: "Demo", addressLine: "1 Main St", phone: null, timezone: "America/New_York" },
    canCancel: true,
    canConfirm: true,
  };

  it("manage.get calls GET /manage/<encoded> without bearer", async () => {
    const { api, calls } = setup({ status: 200, body: view });
    await api.manage.get("a/b c");
    expect(calls[0]!.init.method).toBe("GET");
    expect(calls[0]!.url).toBe("http://x/v1/manage/a%2Fb%20c");
    expect(calls[0]!.init.headers.authorization).toBeUndefined();
  });

  it("manage.cancel posts the reason without bearer", async () => {
    const { api, calls } = setup({ status: 200, body: view });
    await api.manage.cancel("tok1", { reason: "sick" });
    expect(calls[0]!.url).toBe("http://x/v1/manage/tok1/cancel");
    expect(calls[0]!.init.method).toBe("POST");
    expect(JSON.parse(calls[0]!.init.body as string)).toEqual({ reason: "sick" });
    expect(calls[0]!.init.headers.authorization).toBeUndefined();
  });

  it("manage.confirm posts to /confirm", async () => {
    const { api, calls } = setup({ status: 200, body: view });
    await api.manage.confirm("tok1");
    expect(calls[0]!.url).toBe("http://x/v1/manage/tok1/confirm");
    expect(calls[0]!.init.method).toBe("POST");
  });

  it("calendarUrl encodes the token and is absolute", () => {
    const { api } = setup({ status: 200 });
    expect(api.manage.calendarUrl("a/b")).toBe("http://x/v1/manage/a%2Fb/calendar.ics");
  });

  it("push.subscribe posts body with bearer", async () => {
    const { api, calls } = setup({ status: 204 });
    const body = { endpoint: "https://push.example/1", keys: { p256dh: "k", auth: "a" } };
    await api.push.subscribe(body);
    expect(calls[0]!.url).toBe("http://x/v1/me/push-subscriptions");
    expect(calls[0]!.init.method).toBe("POST");
    expect(JSON.parse(calls[0]!.init.body as string)).toEqual(body);
    expect(calls[0]!.init.headers.authorization).toBe("Bearer tok");
  });

  it("push.unsubscribe sends DELETE and publicKey is public", async () => {
    const a = setup({ status: 204 });
    await a.api.push.unsubscribe({ endpoint: "https://push.example/1" });
    expect(a.calls[0]!.init.method).toBe("DELETE");
    const b = setup({ status: 200, body: { publicKey: "BK" } });
    await expect(b.api.push.publicKey()).resolves.toEqual({ publicKey: "BK" });
    expect(b.calls[0]!.url).toBe("http://x/v1/push/public-key");
    expect(b.calls[0]!.init.headers.authorization).toBeUndefined();
  });
});
