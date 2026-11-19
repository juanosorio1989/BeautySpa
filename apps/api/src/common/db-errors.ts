/**
 * Extracts the PostgreSQL SQLSTATE from a Prisma error. Prisma 6 does not map
 * exclusion (23P01) or check (23514) violations to a P-code: it throws
 * PrismaClientUnknownRequestError with no `meta`/`cause`, and the SQLSTATE
 * appears only in the message as `code: "23P01"`. `meta.code` / `cause.code`
 * are checked first in case a future Prisma version exposes them.
 */
export function pgCode(err: unknown): string | undefined {
  if (typeof err !== "object" || err === null) return undefined;
  const e = err as { meta?: Record<string, unknown>; cause?: { code?: unknown }; message?: string };
  const metaCode = e.meta?.code;
  if (typeof metaCode === "string" && /^[0-9A-Z]{5}$/.test(metaCode)) return metaCode;
  const causeCode = e.cause?.code;
  if (typeof causeCode === "string" && /^[0-9A-Z]{5}$/.test(causeCode)) return causeCode;
  return /code: "([0-9A-Z]{5})"/.exec(e.message ?? "")?.[1];
}

/** The Prisma error code (`P2002`, ...) of a known request error, if any. */
function prismaCode(err: unknown): string | undefined {
  if (typeof err !== "object" || err === null) return undefined;
  const code = (err as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

/** Unique constraint violation: Prisma `P2002` or SQLSTATE `23505` (raw queries). */
export function isUniqueViolation(err: unknown): boolean {
  return prismaCode(err) === "P2002" || pgCode(err) === "23505";
}

/** Foreign key violation: Prisma `P2003` or SQLSTATE `23503` (raw queries). */
export function isForeignKeyViolation(err: unknown): boolean {
  return prismaCode(err) === "P2003" || pgCode(err) === "23503";
}
