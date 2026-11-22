import {
  AppointmentSchema,
  BookInputSchema,
  CancelInputSchema,
  CustomerExportSchema,
  HoldInputSchema,
  HoldSchema,
  MePatchSchema,
  MeSchema,
  MyAppointmentsSchema,
  PublicEmployeeSchema,
  PublicLocationSchema,
  PublicServicesResponseSchema,
  RepeatSchema,
  RescheduleInputSchema,
  SlotSchema,
  type Appointment,
  type CustomerExport,
  type Hold,
  type Me,
  type MyAppointments,
  type PublicEmployee,
  type PublicLocation,
  type PublicServicesResponse,
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

// URLSearchParams is not in this package's lib (no DOM/Node types); encode by hand.
type Query = [string, string][];

const withQuery = (path: string, params: Query): string =>
  params.length
    ? `${path}?${params.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&")}`
    : path;

const locationQuery = (q?: { locationId?: string }): Query => (q?.locationId ? [["locationId", q.locationId]] : []);

export function createResources(request: <T>(o: RequestOptions<T>) => Promise<T>): {
  public: PublicApi;
  booking: BookingApi;
  me: MeApi;
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

  return { public: pub, booking, me };
}
