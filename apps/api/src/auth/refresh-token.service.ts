import { randomUUID } from "node:crypto";
import { Injectable, UnauthorizedException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { AuditService } from "../audit/audit.service.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { TenancyService } from "../tenancy/tenancy.service.js";
import { randomToken, sha256Hex } from "./crypto/tokens.js";
import type { RequestMeta, Subject } from "./request-meta.js";

export const REFRESH_TTL_MS: Record<Subject["type"], number> = {
  CUSTOMER: 30 * 24 * 3600_000,
  STAFF: 12 * 3600_000,
};

type RotateOutcome =
  | { kind: "ok"; subject: Subject; token: string; expiresAt: Date }
  | { kind: "invalid" }
  | { kind: "reuse" };

const unauthorized = () => new UnauthorizedException({ code: "UNAUTHORIZED" });

/**
 * Opaque refresh tokens (32 random bytes, base64url). Only `sha256Hex(token)` is
 * stored. Each login starts a family; every refresh rotates the token within
 * the family and the successor inherits `expires_at` (absolute lifetime per
 * login). Presenting a rotated or revoked token revokes the whole family.
 */
@Injectable()
export class RefreshTokenService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly tenancy: TenancyService,
  ) {}

  async create(subject: Subject, meta: RequestMeta): Promise<{ token: string; expiresAt: Date }> {
    const token = randomToken();
    const expiresAt = new Date(Date.now() + REFRESH_TTL_MS[subject.type]);
    await this.prisma.refreshToken.create({
      data: {
        subjectType: subject.type,
        subjectId: subject.id,
        familyId: randomUUID(),
        tokenHash: sha256Hex(token),
        expiresAt,
        userAgent: meta.userAgent,
        ip: meta.ip,
      },
    });
    return { token, expiresAt };
  }

  /**
   * Rotates `token`. Throws 401 `UNAUTHORIZED` when it is unknown, expired,
   * already rotated or revoked (the last two revoke the family and write an
   * `auth.refresh_reuse` audit row, committed before the 401 is thrown).
   */
  async rotate(token: string, meta: RequestMeta): Promise<{ subject: Subject; token: string; expiresAt: Date }> {
    const outcome = await this.prisma.$transaction(async (tx): Promise<RotateOutcome> => {
      const now = new Date();
      const current = await tx.refreshToken.findUnique({ where: { tokenHash: sha256Hex(token) } });
      if (!current || current.expiresAt <= now) return { kind: "invalid" };

      const claimed =
        current.rotatedAt === null && current.revokedAt === null
          ? await tx.refreshToken.updateMany({
              where: { id: current.id, rotatedAt: null, revokedAt: null },
              data: { rotatedAt: now },
            })
          : { count: 0 };
      if (claimed.count !== 1) {
        // Reuse of a spent token, or a concurrent rotation that lost the race.
        await this.revokeFamily(tx, current.familyId, now);
        await this.audit.record(
          {
            orgId: await this.tenancy.getOrgId(),
            actorType: "SYSTEM",
            actorId: null,
            action: "auth.refresh_reuse",
            entity: "refresh_token_family",
            entityId: current.familyId,
            after: { subjectType: current.subjectType, subjectId: current.subjectId },
            ip: meta.ip,
          },
          tx,
        );
        return { kind: "reuse" };
      }

      const next = randomToken();
      await tx.refreshToken.create({
        data: {
          subjectType: current.subjectType,
          subjectId: current.subjectId,
          familyId: current.familyId,
          tokenHash: sha256Hex(next),
          expiresAt: current.expiresAt,
          userAgent: meta.userAgent,
          ip: meta.ip,
        },
      });
      return {
        kind: "ok",
        subject: { type: current.subjectType, id: current.subjectId },
        token: next,
        expiresAt: current.expiresAt,
      };
    });
    if (outcome.kind !== "ok") throw unauthorized();
    return { subject: outcome.subject, token: outcome.token, expiresAt: outcome.expiresAt };
  }

  /** Revokes the family `token` belongs to. No-op for an unknown token. */
  async revokeFamilyOf(token: string): Promise<void> {
    const row = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: sha256Hex(token) },
      select: { familyId: true },
    });
    if (row) await this.revokeFamily(this.prisma, row.familyId, new Date());
  }

  /** Revokes every live refresh token of `subject` (all devices). */
  async revokeAllFor(subject: Subject): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { subjectType: subject.type, subjectId: subject.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  private async revokeFamily(db: Prisma.TransactionClient, familyId: string, now: Date): Promise<void> {
    await db.refreshToken.updateMany({ where: { familyId, revokedAt: null }, data: { revokedAt: now } });
  }
}
