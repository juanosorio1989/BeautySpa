import { z } from "zod";
import { IdSchema, IsoInstantSchema } from "./common";

export const AuditQuerySchema = z.object({
  entity: z.string().max(64).optional(),
  id: z.string().max(200).optional(),
  cursor: IdSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type AuditQuery = z.infer<typeof AuditQuerySchema>;

export const AuditEntrySchema = z.object({
  id: IdSchema,
  actorType: z.enum(["STAFF", "CUSTOMER", "SYSTEM"]),
  actorId: IdSchema.nullable(),
  action: z.string(),
  entity: z.string(),
  entityId: z.string().nullable(),
  before: z.unknown().nullable(),
  after: z.unknown().nullable(),
  ip: z.string().nullable(),
  at: IsoInstantSchema,
});
export type AuditEntry = z.infer<typeof AuditEntrySchema>;

export const AuditPageSchema = z.object({ items: z.array(AuditEntrySchema), nextCursor: IdSchema.nullable() });
export type AuditPage = z.infer<typeof AuditPageSchema>;
