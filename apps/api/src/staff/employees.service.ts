import { BadRequestException, ConflictException, ForbiddenException, Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type {
  AccessClaims,
  Employee,
  EmployeeCreate,
  EmployeeProfile,
  EmployeeUpdate,
  Locale,
  LocalizedText,
} from "@beautyspa/contracts";
import { AuditService } from "../audit/audit.service.js";
import { recordStaffAudit } from "../audit/staff-audit.js";
import { StaffLinksService } from "../auth/staff/staff-links.service.js";
import { RefreshTokenService } from "../auth/refresh-token.service.js";
import { isUniqueViolation } from "../common/db-errors.js";
import { invalidRef, notFound } from "../common/http-errors.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { LocationService } from "../tenancy/location.service.js";

const include = {
  staffLocations: { select: { locationId: true } },
  employeeProfile: true,
  employeeServices: { select: { serviceId: true } },
} as const;

type EmployeeRow = Prisma.StaffUserGetPayload<{ include: typeof include }>;

const emailTaken = () => new ConflictException({ code: "CONFLICT", message: "Email already in use" });

/** 400 `VALIDATION_FAILED` for a rule on the resulting row (not a bad reference). */
function invalidState(path: string, message: string): BadRequestException {
  return new BadRequestException({
    code: "VALIDATION_FAILED",
    message: "Validation failed",
    errors: [{ path, message }],
  });
}

/**
 * Staff members ("employees": OWNER, RECEPTION and EMPLOYEE). There is no hard
 * delete: deactivate with `active: false`. Changing a member's role or email
 * (your own email included), or turning `active`/`canLogin` off, revokes their
 * refresh tokens and spends their pending invite/reset links in the same
 * transaction.
 */
@Injectable()
export class EmployeesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly locations: LocationService,
    private readonly links: StaffLinksService,
    private readonly refreshTokens: RefreshTokenService,
  ) {}

  /** Active first, then `profile.displayName ?? email`. */
  async list(orgId: string, filter: { active?: boolean; locationId?: string } = {}): Promise<Employee[]> {
    const rows = await this.prisma.staffUser.findMany({
      where: {
        organizationId: orgId,
        ...(filter.active !== undefined ? { active: filter.active } : {}),
        ...(filter.locationId !== undefined ? { staffLocations: { some: { locationId: filter.locationId } } } : {}),
      },
      include,
    });
    const label = (r: EmployeeRow) => r.employeeProfile?.displayName ?? r.email ?? "";
    return rows
      .sort((a, b) => (a.active !== b.active ? (a.active ? -1 : 1) : label(a).localeCompare(label(b), "en")))
      .map((r) => this.toDto(r));
  }

  async get(orgId: string, id: string): Promise<Employee> {
    const row = await this.prisma.staffUser.findFirst({ where: { id, organizationId: orgId }, include });
    if (!row) throw notFound("Employee");
    return this.toDto(row);
  }

  /** One transaction with its audit row; the invite (if asked) is sent after commit. */
  async create(principal: AccessClaims, input: EmployeeCreate, ip: string | null): Promise<Employee> {
    const dto = await this.mapUnique(() =>
      this.prisma.$transaction(async (tx) => {
        const locationIds = input.locationIds ?? [await this.defaultLocationId(tx, principal.org)];
        await this.locations.assertInOrg(principal.org, locationIds, "locationIds", tx);
        await this.assertRefs(tx, principal.org, input.profile, input.serviceIds);
        const row = await tx.staffUser.create({
          data: {
            organizationId: principal.org,
            role: input.role,
            email: input.email,
            locale: input.locale,
            canLogin: input.canLogin,
            staffLocations: { create: locationIds.map((locationId) => ({ locationId })) },
            ...(input.profile ? { employeeProfile: { create: this.profileData(input.profile) } } : {}),
            employeeServices: { create: input.serviceIds.map((serviceId) => ({ serviceId })) },
          },
          include,
        });
        const created = this.toDto(row);
        await recordStaffAudit(this.audit, tx, principal, "staff_user", "create", created.id, null, created, ip);
        return created;
      }),
    );
    if (input.sendInvite) await this.links.inviteByOwner(principal, dto.id, ip);
    return dto;
  }

  update(principal: AccessClaims, id: string, patch: EmployeeUpdate, ip: string | null): Promise<Employee> {
    if (
      id === principal.sub &&
      (patch.role !== undefined || patch.active !== undefined || patch.canLogin !== undefined)
    ) {
      throw new ForbiddenException({ code: "FORBIDDEN", message: "You cannot change your own role or access" });
    }
    return this.mapUnique(() =>
      this.prisma.$transaction(async (tx) => {
        const locked = await tx.$queryRaw<{ id: string }[]>`
          SELECT id FROM staff_user
          WHERE id = ${id}::uuid AND organization_id = ${principal.org}::uuid
          FOR UPDATE`;
        if (locked.length === 0) throw notFound("Employee");
        const current = await tx.staffUser.findUniqueOrThrow({ where: { id }, include });
        const before = this.toDto(current);

        const email = patch.email !== undefined ? patch.email : current.email;
        const canLogin = patch.canLogin ?? current.canLogin;
        const hasProfile = patch.profile !== undefined ? patch.profile !== null : current.employeeProfile !== null;
        const serviceIds = patch.serviceIds ?? (hasProfile ? before.serviceIds : []);
        if (canLogin && !email) throw invalidState("email", "canLogin requires email");
        if (serviceIds.length > 0 && !hasProfile) throw invalidState("serviceIds", "serviceIds require a profile");

        if (patch.locationIds !== undefined) {
          await this.locations.assertInOrg(principal.org, patch.locationIds, "locationIds", tx);
        }
        await this.assertRefs(tx, principal.org, patch.profile ?? null, patch.serviceIds ?? []);

        if (patch.locationIds !== undefined) {
          const removed = before.locationIds.filter((l) => !patch.locationIds!.includes(l));
          if (removed.length > 0) {
            await tx.workingHours.deleteMany({ where: { staffUserId: id, locationId: { in: removed } } });
            await tx.timeOff.deleteMany({ where: { staffUserId: id, locationId: { in: removed } } });
          }
          await tx.staffLocation.deleteMany({ where: { staffUserId: id } });
          await tx.staffLocation.createMany({
            data: patch.locationIds.map((locationId) => ({ staffUserId: id, locationId })),
          });
        }
        if (patch.profile === null) {
          await tx.employeeProfile.deleteMany({ where: { staffUserId: id } });
        } else if (patch.profile !== undefined) {
          const data = this.profileData(patch.profile);
          await tx.employeeProfile.upsert({
            where: { staffUserId: id },
            create: { staffUserId: id, ...data },
            update: data,
          });
        }
        if (patch.serviceIds !== undefined || patch.profile === null) {
          await tx.employeeService.deleteMany({ where: { staffUserId: id } });
          await tx.employeeService.createMany({
            data: serviceIds.map((serviceId) => ({ staffUserId: id, serviceId })),
          });
        }

        const row = await tx.staffUser.update({
          where: { id },
          data: {
            ...(patch.role !== undefined ? { role: patch.role } : {}),
            ...(patch.email !== undefined ? { email: patch.email } : {}),
            ...(patch.locale !== undefined ? { locale: patch.locale } : {}),
            ...(patch.canLogin !== undefined ? { canLogin: patch.canLogin } : {}),
            ...(patch.active !== undefined ? { active: patch.active } : {}),
          },
          include,
        });

        const endsSessions =
          (patch.role !== undefined && patch.role !== current.role) ||
          (patch.email !== undefined && patch.email !== current.email) ||
          (patch.active === false && current.active) ||
          (patch.canLogin === false && current.canLogin);
        if (endsSessions) {
          // Pending invite/reset links would otherwise restore access or reach the old address.
          await this.refreshTokens.revokeAllFor({ type: "STAFF", id }, tx);
          await this.links.endPendingLinks(id, tx);
        }

        const after = this.toDto(row);
        await recordStaffAudit(this.audit, tx, principal, "staff_user", "update", id, before, after, ip);
        return after;
      }),
    );
  }

  /** The API shape of a staff row; never exposes `passwordHash` or `totpSecretEnc`. */
  toDto(row: EmployeeRow): Employee {
    const p = row.employeeProfile;
    return {
      id: row.id,
      role: row.role,
      email: row.email,
      locale: row.locale as Locale,
      canLogin: row.canLogin,
      active: row.active,
      hasPassword: row.passwordHash !== null,
      mfaEnrolled: row.totpEnrolledAt !== null,
      locationIds: row.staffLocations.map((l) => l.locationId).sort(),
      profile: p
        ? {
            displayName: p.displayName,
            bio: p.bio as LocalizedText | null,
            photoUrl: p.photoUrl,
            levelId: p.levelId,
            bookableOnline: p.bookableOnline,
          }
        : null,
      serviceIds: row.employeeServices.map((s) => s.serviceId).sort(),
    };
  }

  private profileData(p: EmployeeProfile) {
    return {
      displayName: p.displayName,
      bio: p.bio === null ? Prisma.DbNull : p.bio,
      photoUrl: p.photoUrl,
      levelId: p.levelId,
      bookableOnline: p.bookableOnline,
    };
  }

  /** The only location of the organization; 400 on `locationIds` when there are several. */
  private async defaultLocationId(tx: Prisma.TransactionClient, orgId: string): Promise<string> {
    if ((await tx.location.count({ where: { organizationId: orgId } })) > 1) {
      throw invalidRef("locationIds", "locationIds is required when there are several locations");
    }
    return (await this.locations.resolve(orgId, undefined, tx)).id;
  }

  /** 400 on the first `profile.levelId` / `serviceIds.<i>` that is not a row of the organization. */
  private async assertRefs(
    tx: Prisma.TransactionClient,
    orgId: string,
    profile: EmployeeProfile | null,
    serviceIds: string[],
  ): Promise<void> {
    if (profile?.levelId) {
      const found = await tx.level.findFirst({
        where: { id: profile.levelId, organizationId: orgId },
        select: { id: true },
      });
      if (!found) throw invalidRef("profile.levelId", "Unknown level");
    }
    if (serviceIds.length > 0) {
      const rows = await tx.service.findMany({
        where: { organizationId: orgId, id: { in: serviceIds } },
        select: { id: true },
      });
      const known = new Set(rows.map((r) => r.id));
      const i = serviceIds.findIndex((s) => !known.has(s));
      if (i >= 0) throw invalidRef(`serviceIds.${i}`, "Unknown service");
    }
  }

  /** Maps the `(organization_id, email)` unique violation to 409 `CONFLICT`. */
  private async mapUnique<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      if (isUniqueViolation(err)) throw emailTaken();
      throw err;
    }
  }
}
