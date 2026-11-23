import { Inject, Injectable } from "@nestjs/common";
import type { AppointmentSource, AppointmentStatus } from "@prisma/client";
import { ENV, type Env } from "../config/env.js";
import { PrismaService } from "../prisma/prisma.service.js";
import type { MessageContext, TemplateKey } from "./templates/types.js";

/** One appointment as the notification pipeline sees it: customer-visible values only (no notes, no cancel reason). */
export interface LoadedAppointment {
  id: string;
  organizationId: string;
  status: AppointmentStatus;
  source: AppointmentSource;
  manageVersion: number;
  confirmed: boolean;
  customer: { id: string; email: string | null; locale: string; deletedAt: Date | null; name: string | null } | null;
  /** First segment start. */
  start: Date;
  /** Last customer-facing segment end (`ends_at`, without the cleanup buffer). */
  end: Date;
  /** In segment order; `names` is the translatable service name (`{ en, es }`). */
  services: { names: Record<string, string>; employeeName: string }[];
  location: { name: string; address: string; phone: string | null; timezone: string };
  orgName: string;
}

/** The customer's message locale: `es` when their locale is Spanish, else `en`. */
export function messageLocale(locale: string): MessageContext["locale"] {
  return locale === "es" ? "es" : "en";
}

/** Whether the appointment's status fits the template: `CANCELLED` for cancelled, `BOOKED` for every other key. */
export function statusFits(key: TemplateKey, status: AppointmentStatus): boolean {
  return key === "appointment.cancelled" ? status === "CANCELLED" : status === "BOOKED";
}

/** The location address on one line (line breaks become ", "). */
function oneLine(address: string | null): string {
  return (address ?? "")
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .join(", ");
}

function translations(json: unknown): Record<string, string> {
  if (typeof json !== "object" || json === null) return {};
  return Object.fromEntries(Object.entries(json).filter((e): e is [string, string] => typeof e[1] === "string"));
}

function pick(names: Record<string, string>, locale: string): string {
  return names[locale] ?? names.en ?? Object.values(names)[0] ?? "";
}

/** Loads an appointment for the worker and turns it into the `MessageContext` the templates render. */
@Injectable()
export class MessageContextService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /**
   * The appointment with customer, segments (services and employee display names) and location, or `null`
   * when it does not exist (in `organizationId`, when given) or has no segments. `send` passes no org: the
   * appointment id is the root and later reads use `a.organizationId`; `deliver` passes the log row's org.
   * Every related row is read through the appointment's relations, so it belongs to the same organization.
   */
  async load(appointmentId: string, organizationId?: string): Promise<LoadedAppointment | null> {
    const a = await this.prisma.appointment.findFirst({
      where: { id: appointmentId, ...(organizationId !== undefined ? { organizationId } : {}) },
      select: {
        id: true,
        organizationId: true,
        status: true,
        source: true,
        manageVersion: true,
        confirmedByCustomerAt: true,
        customer: { select: { id: true, email: true, locale: true, deletedAt: true, name: true } },
        location: { select: { name: true, address: true, phone: true, timezone: true } },
        organization: { select: { name: true } },
        segments: {
          orderBy: [{ startsAt: "asc" }, { id: "asc" }],
          select: {
            startsAt: true,
            endsAt: true,
            service: { select: { name: true } },
            staffUser: { select: { employeeProfile: { select: { displayName: true } } } },
          },
        },
      },
    });
    if (!a || a.segments.length === 0) return null;
    const first = a.segments[0]!;
    const end = a.segments.reduce((max, s) => (s.endsAt > max ? s.endsAt : max), first.endsAt);
    return {
      id: a.id,
      organizationId: a.organizationId,
      status: a.status,
      source: a.source,
      manageVersion: a.manageVersion,
      confirmed: a.confirmedByCustomerAt !== null,
      customer: a.customer,
      start: first.startsAt,
      end,
      services: a.segments.map((s) => ({
        names: translations(s.service.name),
        // Never fall back to the staff email: it is not customer-visible.
        employeeName: s.staffUser.employeeProfile?.displayName ?? "",
      })),
      location: {
        name: a.location.name,
        address: oneLine(a.location.address),
        phone: a.location.phone,
        timezone: a.location.timezone,
      },
      orgName: a.organization.name,
    };
  }

  /** `${WEB_ORIGIN}/${locale}/book`. */
  bookUrl(locale: MessageContext["locale"]): string {
    return `${this.env.WEB_ORIGIN}/${locale}/book`;
  }

  /** The render context in `locale` (default: the customer's message locale). */
  toContext(
    a: LoadedAppointment,
    manageUrl: string,
    bookUrl: string,
    locale: MessageContext["locale"] = messageLocale(a.customer?.locale ?? "en"),
  ): MessageContext {
    return {
      locale,
      customerName: a.customer?.name ?? null,
      salonName: a.orgName,
      salonPhone: a.location.phone,
      locationName: a.location.name,
      address: a.location.address,
      timezone: a.location.timezone,
      start: a.start,
      end: a.end,
      services: a.services.map((s) => ({ name: pick(s.names, locale), employeeName: s.employeeName })),
      manageUrl,
      bookUrl,
      confirmed: a.confirmed,
    };
  }
}
