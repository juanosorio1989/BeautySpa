import {
  AppointmentSchema,
  BookInputSchema,
  CancelInputSchema,
  CustomerExportSchema,
  HoldInputSchema,
  HoldSchema,
  ManageCancelInputSchema,
  ManageViewSchema,
  MePatchSchema,
  MeSchema,
  MyAppointmentsSchema,
  PublicEmployeeSchema,
  PushPublicKeySchema,
  PushSubscriptionInputSchema,
  PushUnsubscribeInputSchema,
  PublicLocationSchema,
  PublicServicesResponseSchema,
  RepeatSchema,
  RescheduleInputSchema,
  SlotSchema,
  type Appointment,
  type CustomerExport,
  type Hold,
  type ManageView,
  type Me,
  type MyAppointments,
  type PublicEmployee,
  type PublicLocation,
  type PublicServicesResponse,
  type PushPublicKey,
  type Repeat,
  type ServiceChoice,
  type Slot,
} from "@beautyspa/contracts";
import { z } from "zod";
import type { RequestOptions } from "./client";

type In<S extends z.ZodTypeAny> = z.input<S>;

export interface PublicApi {
  locations(): Promise<PublicLocation[]>;
  services(q?: { locationId?: string }): Promise<PublicServicesResponse>;
  employees(q?: { locationId?: string }): Promise<PublicEmployee[]>;
}

export interface BookingApi {
  availability(q: {
    locationId?: string;
    services: ServiceChoice[];
    date: string;
    excludeAppointmentId?: string;
  }): Promise<Slot[]>;
  createHold(b: In<typeof HoldInputSchema>): Promise<Hold>;
  releaseHold(holdId: string): Promise<void>;
  book(b: In<typeof BookInputSchema>): Promise<Appointment>;
}

export interface MeApi {
  get(): Promise<Me>;
  patch(b: In<typeof MePatchSchema>): Promise<Me>;
  appointments(): Promise<MyAppointments>;
  cancel(id: string, b?: In<typeof CancelInputSchema>): Promise<Appointment>;
  reschedule(id: string, b: In<typeof RescheduleInputSchema>): Promise<Appointment>;
  repeat(id: string): Promise<Repeat>;
  export(): Promise<CustomerExport>;
  remove(): Promise<void>;
}

/** Token-link actions; never authenticated, so they work whoever is (or is not) logged in. */
export interface ManageApi {
  get(token: string): Promise<ManageView>;
  confirm(token: string): Promise<ManageView>;
  cancel(token: string, b?: In<typeof ManageCancelInputSchema>): Promise<ManageView>;
  /** Absolute URL of the `.ics` download. */
  calendarUrl(token: string): string;
}

export interface PushApi {
  publicKey(): Promise<PushPublicKey>;
  subscribe(b: In<typeof PushSubscriptionInputSchema>): Promise<void>;
  unsubscribe(b: In<typeof PushUnsubscribeInputSchema>): Promise<void>;
}

// URLSearchParams is not in this package's lib (no DOM/Node types); encode by hand.
type Query = [string, string][];

const withQuery = (path: string, params: Query): string =>
  params.length
    ? `${path}?${params.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&")}`
    : path;

const locationQuery = (q?: { locationId?: string }): Query => (q?.locationId ? [["locationId", q.locationId]] : []);

export function createResources(
  request: <T>(o: RequestOptions<T>) => Promise<T>,
  baseUrl: string,
): {
  public: PublicApi;
  booking: BookingApi;
  me: MeApi;
  manage: ManageApi;
  push: PushApi;
} {
  const pub: PublicApi = {
    locations: () =>
      request({ method: "GET", path: "/public/locations", schema: z.array(PublicLocationSchema), auth: false }),
    services: (q) =>
      request({
        method: "GET",
        path: withQuery("/public/services", locationQuery(q)),
        schema: PublicServicesResponseSchema,
        auth: false,
      }),
    employees: (q) =>
      request({
        method: "GET",
        path: withQuery("/public/employees", locationQuery(q)),
        schema: z.array(PublicEmployeeSchema),
        auth: false,
      }),
  };

  const booking: BookingApi = {
    availability: (q) => {
      const params = locationQuery(q);
      for (const s of q.services) params.push(["services", `${s.serviceId}:${s.employeeId}`]);
      params.push(["date", q.date]);
      if (q.excludeAppointmentId) params.push(["excludeAppointmentId", q.excludeAppointmentId]);
      return request({
        method: "GET",
        path: withQuery("/availability", params),
        schema: z.array(SlotSchema),
        auth: true,
      });
    },
    createHold: (b) => request({ method: "POST", path: "/holds", body: b, schema: HoldSchema, auth: false }),
    releaseHold: (holdId) =>
      request({ method: "DELETE", path: `/holds/${encodeURIComponent(holdId)}`, schema: null, auth: false }),
    book: (b) => request({ method: "POST", path: "/appointments", body: b, schema: AppointmentSchema, auth: true }),
  };

  const me: MeApi = {
    get: () => request({ method: "GET", path: "/me", schema: MeSchema }),
    patch: (b) => request({ method: "PATCH", path: "/me", body: b, schema: MeSchema }),
    appointments: () => request({ method: "GET", path: "/me/appointments", schema: MyAppointmentsSchema }),
    cancel: (id, b) =>
      request({
        method: "POST",
        path: `/me/appointments/${encodeURIComponent(id)}/cancel`,
        body: b ?? {},
        schema: AppointmentSchema,
      }),
    reschedule: (id, b) =>
      request({
        method: "POST",
        path: `/me/appointments/${encodeURIComponent(id)}/reschedule`,
        body: b,
        schema: AppointmentSchema,
      }),
    repeat: (id) =>
      request({
        method: "POST",
        path: `/me/appointments/${encodeURIComponent(id)}/repeat`,
        schema: RepeatSchema,
      }),
    export: () => request({ method: "GET", path: "/me/export", schema: CustomerExportSchema }),
    remove: () => request({ method: "DELETE", path: "/me", schema: null }),
  };

  const managePath = (token: string, rest = ""): string => `/manage/${encodeURIComponent(token)}${rest}`;
  const manage: ManageApi = {
    get: (token) => request({ method: "GET", path: managePath(token), schema: ManageViewSchema, auth: false }),
    confirm: (token) =>
      request({ method: "POST", path: managePath(token, "/confirm"), schema: ManageViewSchema, auth: false }),
    cancel: (token, b) =>
      request({
        method: "POST",
        path: managePath(token, "/cancel"),
        body: b ?? {},
        schema: ManageViewSchema,
        auth: false,
      }),
    calendarUrl: (token) => `${baseUrl}/v1${managePath(token, "/calendar.ics")}`,
  };

  const push: PushApi = {
    publicKey: () => request({ method: "GET", path: "/push/public-key", schema: PushPublicKeySchema, auth: false }),
    subscribe: (b) => request({ method: "POST", path: "/me/push-subscriptions", body: b, schema: null }),
    unsubscribe: (b) => request({ method: "DELETE", path: "/me/push-subscriptions", body: b, schema: null }),
  };

  return { public: pub, booking, me, manage, push };
}
