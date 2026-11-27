import { Inject, Injectable } from "@nestjs/common";
import type { AccessClaims, CustomerNotes, CustomerNotesInput } from "@beautyspa/contracts";
import { AuditService } from "../audit/audit.service.js";
import { Encryptor } from "../auth/crypto/encryption.js";
import { CLOCK, type Clock } from "../common/clock.js";
import { notFound } from "../common/http-errors.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { staffDisplayName } from "../staff/staff-me.service.js";

const NOTES_SELECT = {
  privateNotesEnc: true,
  privateNotesUpdatedAt: true,
  privateNotesAuthor: { select: { id: true, email: true, employeeProfile: { select: { displayName: true } } } },
} as const;

type NotesRow = {
  privateNotesEnc: string | null;
  privateNotesUpdatedAt: Date | null;
  privateNotesAuthor: { id: string; email: string | null; employeeProfile: { displayName: string } | null } | null;
};

/**
 * Staff-only private notes on a customer: one text per customer, last write wins. The text is
 * stored AES-256-GCM encrypted in `customer.private_notes_enc`; it never reaches the audit log
 * or the customer's own export (`GET /me/export`), and account deletion clears it.
 */
@Injectable()
export class CustomerNotesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly encryptor: Encryptor,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /** The notes of a customer of the org (not deleted), else 404. */
  async get(principal: AccessClaims, id: string): Promise<CustomerNotes> {
    const row = await this.prisma.customer.findFirst({
      where: { id, organizationId: principal.org, deletedAt: null },
      select: NOTES_SELECT,
    });
    if (!row) throw notFound("Customer");
    return this.toDto(row);
  }

  /**
   * Replaces the notes (null clears them) and stamps `updatedAt` (clock) and `updatedBy` (the
   * caller). Audit `customer.notes` with `{ changed: true }` only, in the same transaction.
   */
  async put(principal: AccessClaims, id: string, input: CustomerNotesInput, ip: string | null): Promise<CustomerNotes> {
    const orgId = principal.org;
    const privateNotesEnc = input.notes === null ? null : this.encryptor.encrypt(input.notes);
    return this.prisma.$transaction(async (tx) => {
      const { count } = await tx.customer.updateMany({
        where: { id, organizationId: orgId, deletedAt: null },
        data: {
          privateNotesEnc,
          privateNotesUpdatedAt: new Date(this.clock.now()),
          privateNotesUpdatedBy: principal.sub,
        },
      });
      if (count === 0) throw notFound("Customer");
      await this.audit.record(
        {
          orgId,
          actorType: "STAFF",
          actorId: principal.sub,
          action: "customer.notes",
          entity: "customer",
          entityId: id,
          before: { changed: true },
          after: { changed: true },
          ip,
        },
        tx,
      );
      const row = await tx.customer.findFirstOrThrow({ where: { id, organizationId: orgId }, select: NOTES_SELECT });
      return this.toDto(row);
    });
  }

  private toDto(row: NotesRow): CustomerNotes {
    const author = row.privateNotesAuthor;
    return {
      notes: row.privateNotesEnc === null ? null : this.encryptor.decrypt(row.privateNotesEnc),
      updatedAt: row.privateNotesUpdatedAt?.toISOString() ?? null,
      updatedBy: author ? { id: author.id, name: staffDisplayName(author) } : null,
    };
  }
}
