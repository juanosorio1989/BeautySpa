import { Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import type { AccessClaims, StaffCustomer, StaffCustomerCreate } from "@beautyspa/contracts";
import { AuditService } from "../audit/audit.service.js";
import { isUniqueViolation } from "../common/db-errors.js";
import { conflict } from "../common/http-errors.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { currentConsents, recordConsents, toCustomerDto } from "./consents.js";

const SEARCH_LIMIT = 20;
const MIN_PHONE_DIGITS = 4;

/** Staff customer search and creation. */
@Injectable()
export class StaffCustomersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Customers of the org (not deleted) whose name contains `q`, or, with at least 4 digits in
   * `q`, whose phone contains those digits; by name, at most 20. An EMPLOYEE only finds
   * customers with a non-`HELD` appointment that has a segment of theirs.
   */
  async search(principal: AccessClaims, q: string): Promise<StaffCustomer[]> {
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
    return Promise.all(rows.map(async (r) => toCustomerDto(r, await currentConsents(this.prisma, r.id))));
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
