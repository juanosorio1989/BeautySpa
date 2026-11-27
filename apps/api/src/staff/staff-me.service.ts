import { Injectable } from "@nestjs/common";
import type { AccessClaims, StaffMe } from "@beautyspa/contracts";
import { notFound } from "../common/http-errors.js";
import { PrismaService } from "../prisma/prisma.service.js";

/** `staff_user` has no name: the profile display name, else the email (empty when neither exists). */
export function staffDisplayName(row: {
  email: string | null;
  employeeProfile: { displayName: string } | null;
}): string {
  return row.employeeProfile?.displayName ?? row.email ?? "";
}

/** The signed-in staff user. */
@Injectable()
export class StaffMeService {
  constructor(private readonly prisma: PrismaService) {}

  async me(principal: AccessClaims): Promise<StaffMe> {
    const row = await this.prisma.staffUser.findFirst({
      where: { id: principal.sub, organizationId: principal.org },
      select: { id: true, email: true, role: true, employeeProfile: { select: { displayName: true } } },
    });
    if (!row) throw notFound("Staff user");
    return { id: row.id, name: staffDisplayName(row), email: row.email ?? "", role: row.role };
  }
}
