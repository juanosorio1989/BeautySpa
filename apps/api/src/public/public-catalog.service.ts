import { Injectable } from "@nestjs/common";
import type { Level, LocalizedText } from "@beautyspa/contracts";
import { PrismaService } from "../prisma/prisma.service.js";

export interface BookableEmployee {
  id: string;
  displayName: string;
  bio: LocalizedText | null;
  photoUrl: string | null;
  level: Level | null;
  /** Every service the employee is qualified for (active or not); callers filter. */
  serviceIds: string[];
}

/** Reads behind the public catalog; `bookableEmployees` is also used by booking (plan 04). */
@Injectable()
export class PublicCatalogService {
  constructor(private readonly prisma: PrismaService) {}

  /** Active staff with a `bookableOnline` profile assigned to the location, with service ids and level. */
  async bookableEmployees(orgId: string, locationId: string): Promise<BookableEmployee[]> {
    const rows = await this.prisma.staffUser.findMany({
      where: {
        organizationId: orgId,
        active: true,
        employeeProfile: { is: { bookableOnline: true } },
        staffLocations: { some: { locationId } },
      },
      include: { employeeProfile: { include: { level: true } }, employeeServices: { select: { serviceId: true } } },
    });
    return rows.map((r) => {
      const p = r.employeeProfile!;
      return {
        id: r.id,
        displayName: p.displayName,
        bio: p.bio as LocalizedText | null,
        photoUrl: p.photoUrl,
        level: p.level ? { id: p.level.id, name: p.level.name as LocalizedText, rank: p.level.rank } : null,
        serviceIds: r.employeeServices.map((s) => s.serviceId),
      };
    });
  }
}
