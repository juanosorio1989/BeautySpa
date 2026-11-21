import { SetMetadata, createParamDecorator, type ExecutionContext } from "@nestjs/common";
import type { Request } from "express";
import type { AccessClaims, StaffRole } from "@beautyspa/contracts";

/** Metadata key read by `AccessGuard`. A route without it is denied (403). */
export const AUTH_POLICY = "auth:policy";

export type AuthPolicy =
  { kind: "public" } | { kind: "optional" } | { kind: "customer" } | { kind: "staff"; roles: readonly StaffRole[] };

/** A request that passed `AccessGuard` with a token. */
export type AuthedRequest = Request & { principal?: AccessClaims };

/** No token required. */
export const Public = () => SetMetadata(AUTH_POLICY, { kind: "public" } satisfies AuthPolicy);

/**
 * Anonymous or any access token. No `Authorization` header: allowed without a
 * principal. A header present: verified like every other policy (invalid,
 * expired or other-org token → 401), then any kind or role is allowed.
 */
export const OptionalAuth = () => SetMetadata(AUTH_POLICY, { kind: "optional" } satisfies AuthPolicy);

/** A customer access token for this organization. */
export const CustomerAuth = () => SetMetadata(AUTH_POLICY, { kind: "customer" } satisfies AuthPolicy);

/** A staff access token for this organization; with `roles`, one of them (none = any staff role). */
export const StaffAuth = (...roles: StaffRole[]) =>
  SetMetadata(AUTH_POLICY, { kind: "staff", roles } satisfies AuthPolicy);

/** The verified access claims set by `AccessGuard` (undefined on `@Public()` routes and anonymous `@OptionalAuth()` requests). */
export const Principal = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AccessClaims | undefined =>
    ctx.switchToHttp().getRequest<AuthedRequest>().principal,
);
