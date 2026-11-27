import {
  AgendaSchema,
  AppointmentSchema,
  BookingCatalogSchema,
  BookInputSchema,
  CancelInputSchema,
  CustomerExportSchema,
  CustomerNotesInputSchema,
  CustomerNotesSchema,
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
  StaffAppointmentInputSchema,
  StaffAppointmentPatchSchema,
  StaffAppointmentSchema,
  StaffCustomerAppointmentsSchema,
  StaffCustomerCreateSchema,
  StaffCustomerSchema,
  StaffCustomerSearchResultSchema,
  StaffMeSchema,
  StatusChangeSchema,
  WalkInInputSchema,
  type Agenda,
  type Appointment,
  type BookingCatalog,
  type CustomerNotes,
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
  type StaffAppointment,
  type StaffCustomer,
  type StaffCustomerAppointments,
  type StaffCustomerSearchResult,
  type StaffMe,
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

export interface StaffApi {
  me(): Promise<StaffMe>;
  agenda(q: { date: string; locationId?: string; employeeId?: string; includeCancelled?: boolean }): Promise<Agenda>;
  bookingCatalog(q?: { locationId?: string }): Promise<BookingCatalog>;
  availability(q: {
    services: ServiceChoice[];
    date: string;
    locationId?: string;
    excludeAppointmentId?: string;
    override?: boolean;
  }): Promise<Slot[]>;
  createAppointment(b: In<typeof StaffAppointmentInputSchema>): Promise<StaffAppointment>;
  moveAppointment(id: string, b: In<typeof StaffAppointmentPatchSchema>): Promise<StaffAppointment>;
  setStatus(id: string, b: In<typeof StatusChangeSchema>): Promise<StaffAppointment>;
  walkIn(b: In<typeof WalkInInputSchema>): Promise<StaffAppointment>;
  searchCustomers(q: string): Promise<StaffCustomerSearchResult[]>;
  createCustomer(b: In<typeof StaffCustomerCreateSchema>): Promise<StaffCustomer>;
  customer(id: string): Promise<StaffCustomer>;
  customerAppointments(id: string): Promise<StaffCustomerAppointments>;
  notes(customerId: string): Promise<CustomerNotes>;
  saveNotes(customerId: string, b: In<typeof CustomerNotesInputSchema>): Promise<CustomerNotes>;
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

const availabilityParams = (q: {
  locationId?: string;
  services: ServiceChoice[];
  date: string;
  excludeAppointmentId?: string;
}): Query => {
  const params = locationQuery(q);
  for (const s of q.services) params.push(["services", `${s.serviceId}:${s.employeeId}`]);
  params.push(["date", q.date]);
  if (q.excludeAppointmentId) params.push(["excludeAppointmentId", q.excludeAppointmentId]);
  return params;
};

const enc = encodeURIComponent;

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
  staff: StaffApi;
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
      return request({
        method: "GET",
        path: withQuery("/availability", availabilityParams(q)),
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

  const staff: StaffApi = {
    me: () => request({ method: "GET", path: "/staff/me", schema: StaffMeSchema }),
    agenda: (q) => {
      const params: Query = [["date", q.date]];
      if (q.locationId) params.push(["locationId", q.locationId]);
      if (q.employeeId) params.push(["employeeId", q.employeeId]);
      if (q.includeCancelled === true) params.push(["includeCancelled", "true"]);
      return request({ method: "GET", path: withQuery("/staff/agenda", params), schema: AgendaSchema });
    },
    bookingCatalog: (q) =>
      request({
        method: "GET",
        path: withQuery("/staff/booking-catalog", locationQuery(q)),
        schema: BookingCatalogSchema,
      }),
    availability: (q) => {
      const params = availabilityParams(q);
      if (q.override === true) params.push(["override", "true"]);
      return request({ method: "GET", path: withQuery("/availability", params), schema: z.array(SlotSchema) });
    },
    createAppointment: (b) =>
      request({ method: "POST", path: "/staff/appointments", body: b, schema: StaffAppointmentSchema }),
    moveAppointment: (id, b) =>
      request({ method: "PATCH", path: `/staff/appointments/${enc(id)}`, body: b, schema: StaffAppointmentSchema }),
    setStatus: (id, b) =>
      request({
        method: "POST",
        path: `/staff/appointments/${enc(id)}/status`,
        body: b,
        schema: StaffAppointmentSchema,
      }),
    walkIn: (b) => request({ method: "POST", path: "/staff/walk-in", body: b, schema: StaffAppointmentSchema }),
    searchCustomers: (q) =>
      request({
        method: "GET",
        path: withQuery("/staff/customers", [["q", q]]),
        schema: z.array(StaffCustomerSearchResultSchema),
      }),
    createCustomer: (b) => request({ method: "POST", path: "/staff/customers", body: b, schema: StaffCustomerSchema }),
    customer: (id) => request({ method: "GET", path: `/staff/customers/${enc(id)}`, schema: StaffCustomerSchema }),
    customerAppointments: (id) =>
      request({
        method: "GET",
        path: `/staff/customers/${enc(id)}/appointments`,
        schema: StaffCustomerAppointmentsSchema,
      }),
    notes: (id) => request({ method: "GET", path: `/staff/customers/${enc(id)}/notes`, schema: CustomerNotesSchema }),
    saveNotes: (id, b) =>
      request({ method: "PUT", path: `/staff/customers/${enc(id)}/notes`, body: b, schema: CustomerNotesSchema }),
  };

  return { public: pub, booking, me, manage, push, staff };
}
