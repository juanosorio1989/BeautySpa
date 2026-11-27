import { Inject, Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import type {
  AccessClaims,
  StaffCustomer,
  StaffCustomerAppointments,
  StaffCustomerCreate,
  StaffCustomerSearchResult,
} from "@beautyspa/contracts";
import { utcToWall } from "@beautyspa/datetime";
import { AuditService } from "../audit/audit.service.js";
import { isUniqueViolation } from "../common/db-errors.js";
import { CLOCK, type Clock } from "../common/clock.js";
import { conflict, notFound } from "../common/http-errors.js";
import { APPOINTMENT_INCLUDE, startOf, toStaffAppointmentDto } from "../booking/appointment-mapping.js";
import { isUpcoming } from "../booking/my-appointments.service.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { currentConsents, recordConsents, toCustomerDto } from "./consents.js";
import { loadConsents, loadReachableFor } from "./reachability.js";

const SEARCH_LIMIT = 20;
const MIN_PHONE_DIGITS = 4;
const PAST_LIMIT = 20;

/** Staff customer search and creation. */
@Injectable()
export class StaffCustomersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /**
   * Customers of the org (not deleted) whose name contains `q`, or, with at least 4 digits in
   * `q`, whose phone contains those digits; by name, at most 20. An EMPLOYEE only finds
   * customers with a non-`HELD` appointment that has a segment of theirs. Each result carries
   * `lastVisit` (latest `COMPLETED`/`CHECKED_IN` appointment, local date in its location's
   * timezone, service ids in segment order) or null. Consents and visits are read in batches.
   */
  async search(principal: AccessClaims, q: string): Promise<StaffCustomerSearchResult[]> {
    const digits = q.replace(/\D/g, "");
    const or: Prisma.CustomerWhereInput[] = [{ name: { contains: q, mode: "insensitive" } }];
    if (digits.length >= MIN_PHONE_DIGITS) or.push({ phoneE164: { contains: digits } });
    const where: Prisma.CustomerWhereInput = { organizationId: principal.org, deletedAt: null, OR: or };
    if (principal.role === "EMPLOYEE") {
      where.appointments = {
        some: { status: { not: "HELD" }, segments: { some: { staffUserId: principal.sub } } },
      };
    }
    const rows = await this.prisma.customer.findMany({
      where,
      orderBy: [{ name: "asc" }, { id: "asc" }],
      take: SEARCH_LIMIT,
    });
    const ids = rows.map((r) => r.id);
    const [consents, visits] = await Promise.all([loadConsents(this.prisma, ids), this.lastVisits(principal.org, ids)]);
    return rows.map((r) => ({ ...toCustomerDto(r, consents.get(r.id)!), lastVisit: visits.get(r.id) ?? null }));
  }

  /** One customer of the org (not deleted), else 404. */
  async get(principal: AccessClaims, id: string): Promise<StaffCustomer> {
    const row = await this.prisma.customer.findFirst({ where: { id, organizationId: principal.org, deletedAt: null } });
    if (!row) throw notFound("Customer");
    return toCustomerDto(row, await currentConsents(this.prisma, id));
  }

  /**
   * The customer's appointments except `HELD`, split as `MyAppointmentsService` does (`upcoming`
   * ascending, `past` descending) but `past` capped at 20; staff DTOs keep every cancel reason.
   */
  async appointments(principal: AccessClaims, id: string): Promise<StaffCustomerAppointments> {
    const customer = await this.prisma.customer.findFirst({
      where: { id, organizationId: principal.org, deletedAt: null },
      select: { id: true },
    });
    if (!customer) throw notFound("Customer");
    const now = this.clock.now();
    const rows = await this.prisma.appointment.findMany({
      where: { organizationId: principal.org, customerId: id, status: { not: "HELD" } },
      include: APPOINTMENT_INCLUDE,
    });
    const withSegments = rows.filter((r) => r.segments.length > 0);
    const upcoming = withSegments.filter((r) => isUpcoming(r, now)).sort((a, b) => startOf(a) - startOf(b));
    const past = withSegments
      .filter((r) => !isUpcoming(r, now))
      .sort((a, b) => startOf(b) - startOf(a))
      .slice(0, PAST_LIMIT);
    const reachable = await loadReachableFor(this.prisma, [...upcoming, ...past]);
    return {
      upcoming: upcoming.map((r) => toStaffAppointmentDto(r, reachable)),
      past: past.map((r) => toStaffAppointmentDto(r, reachable)),
    };
  }

  /** Latest `COMPLETED`/`CHECKED_IN` appointment per customer: one appointment query for all ids. */
  private async lastVisits(
    orgId: string,
    customerIds: string[],
  ): Promise<Map<string, { date: string; serviceIds: string[] }>> {
    const result = new Map<string, { date: string; serviceIds: string[] }>();
    if (customerIds.length === 0) return result;
    const rows = await this.prisma.appointment.findMany({
      where: { organizationId: orgId, customerId: { in: customerIds }, status: { in: ["COMPLETED", "CHECKED_IN"] } },
      include: { segments: APPOINTMENT_INCLUDE.segments, location: { select: { timezone: true } } },
    });
    const best = new Map<string, (typeof rows)[number]>();
    for (const r of rows) {
      if (r.customerId === null || r.segments.length === 0) continue;
      const cur = best.get(r.customerId);
      if (!cur || startOf(r) > startOf(cur)) best.set(r.customerId, r);
    }
    for (const [customerId, r] of best) {
      result.set(customerId, {
        date: utcToWall(startOf(r), r.location.timezone).date,
        serviceIds: r.segments.map((s) => s.serviceId),
      });
    }
    return result;
  }

  /**
   * Creates a customer at reception (`createdVia RECEPTION`, phone unverified). A duplicate
   * phone in the org is 409 `CONFLICT`. Consents asked as `true` are recorded with source
   * `RECEPTION`. The audit row lists the keys set, never their values.
   */
  async create(principal: AccessClaims, input: StaffCustomerCreate, ip: string | null): Promise<StaffCustomer> {
    const orgId = principal.org;
    try {
      return await this.prisma.$transaction(async (tx) => {
        const row = await tx.customer.create({
          data: {
            organizationId: orgId,
            phoneE164: input.phone,
            name: input.name,
            email: input.email,
            locale: input.locale,
            createdVia: "RECEPTION",
            phoneVerifiedAt: null,
          },
        });
        const wanted = {
          ...(input.consents.WHATSAPP ? { WHATSAPP: true } : {}),
          ...(input.consents.SMS ? { SMS: true } : {}),
          ...(input.consents.EMAIL ? { EMAIL: true } : {}),
        };
        await recordConsents(tx, orgId, row.id, wanted, "RECEPTION");
        const fields = ["name", "phone", "locale", ...(input.email !== null ? ["email"] : [])];
        if (Object.keys(wanted).length > 0) fields.push("consents");
        await this.audit.record(
          {
            orgId,
            actorType: "STAFF",
            actorId: principal.sub,
            action: "customer.create",
            entity: "customer",
            entityId: row.id,
            before: null,
            after: { fields },
            ip,
          },
          tx,
        );
        return toCustomerDto(row, await currentConsents(tx, row.id));
      });
    } catch (err) {
      if (isUniqueViolation(err)) throw conflict("A customer with that phone already exists");
      throw err;
    }
  }
}
