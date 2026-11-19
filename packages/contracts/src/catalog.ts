import { z } from "zod";
import { IdSchema, LocalizedTextSchema, MoneyCentsSchema } from "./common";

const nonEmpty = (o: object) => Object.keys(o).length > 0;
const EMPTY = "Empty update";

export const CategoryInputSchema = z.object({
  name: LocalizedTextSchema,
  sort: z.number().int().min(0).max(10000).default(0),
});
export type CategoryInput = z.infer<typeof CategoryInputSchema>;
export const CategoryUpdateSchema = CategoryInputSchema.partial().refine(nonEmpty, EMPTY);
export type CategoryUpdate = z.infer<typeof CategoryUpdateSchema>;
export const CategorySchema = z.object({ id: IdSchema, name: LocalizedTextSchema, sort: z.number().int() });
export type Category = z.infer<typeof CategorySchema>;

export const LevelInputSchema = z.object({ name: LocalizedTextSchema, rank: z.number().int().min(0).max(100) });
export type LevelInput = z.infer<typeof LevelInputSchema>;
export const LevelUpdateSchema = LevelInputSchema.partial().refine(nonEmpty, EMPTY);
export type LevelUpdate = z.infer<typeof LevelUpdateSchema>;
export const LevelSchema = z.object({ id: IdSchema, name: LocalizedTextSchema, rank: z.number().int() });
export type Level = z.infer<typeof LevelSchema>;

export const ResourceTypeInputSchema = z.object({ name: LocalizedTextSchema });
export type ResourceTypeInput = z.infer<typeof ResourceTypeInputSchema>;
export const ResourceTypeUpdateSchema = ResourceTypeInputSchema.partial().refine(nonEmpty, EMPTY);
export type ResourceTypeUpdate = z.infer<typeof ResourceTypeUpdateSchema>;
export const ResourceTypeSchema = z.object({ id: IdSchema, name: LocalizedTextSchema });
export type ResourceType = z.infer<typeof ResourceTypeSchema>;

export const ResourceInputSchema = z.object({
  locationId: IdSchema.optional(),
  resourceTypeId: IdSchema,
  name: z.string().trim().min(1).max(80),
  active: z.boolean().default(true),
});
export type ResourceInput = z.infer<typeof ResourceInputSchema>;
export const ResourceUpdateSchema = ResourceInputSchema.pick({ resourceTypeId: true, name: true, active: true })
  .partial()
  .refine(nonEmpty, EMPTY);
export type ResourceUpdate = z.infer<typeof ResourceUpdateSchema>;
export const ResourceSchema = z.object({
  id: IdSchema,
  locationId: IdSchema,
  resourceTypeId: IdSchema,
  name: z.string(),
  active: z.boolean(),
});
export type Resource = z.infer<typeof ResourceSchema>;

export const LevelPriceSchema = z.object({
  levelId: IdSchema,
  durationMin: z.number().int().min(5).max(600),
  priceCents: MoneyCentsSchema.max(1_000_000),
});
export type LevelPrice = z.infer<typeof LevelPriceSchema>;

const ServiceFieldsSchema = z.object({
  categoryId: IdSchema.nullable(),
  name: LocalizedTextSchema,
  description: LocalizedTextSchema.nullable().default(null),
  durationMin: z.number().int().min(5).max(600),
  bufferAfterMin: z.number().int().min(0).max(120).default(0),
  priceCents: MoneyCentsSchema.max(1_000_000),
  parallelizable: z.boolean().default(false),
  resourceTypeId: IdSchema.nullable().default(null),
  onlineBookable: z.boolean().default(true),
  active: z.boolean().default(true),
  levelPrices: z.array(LevelPriceSchema).max(20).default([]),
});

function uniqueLevels(o: { levelPrices?: { levelId: string }[] | undefined }, ctx: z.RefinementCtx): void {
  const seen = new Set<string>();
  (o.levelPrices ?? []).forEach((lp, i) => {
    if (seen.has(lp.levelId)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Duplicate level", path: ["levelPrices", i, "levelId"] });
    }
    seen.add(lp.levelId);
  });
}

export const ServiceInputSchema = ServiceFieldsSchema.superRefine(uniqueLevels);
export type ServiceInput = z.infer<typeof ServiceInputSchema>;
export const ServiceUpdateSchema = ServiceFieldsSchema.partial().superRefine(uniqueLevels).refine(nonEmpty, EMPTY);
export type ServiceUpdate = z.infer<typeof ServiceUpdateSchema>;
export const ServiceSchema = z.object({
  id: IdSchema,
  categoryId: IdSchema.nullable(),
  name: LocalizedTextSchema,
  description: LocalizedTextSchema.nullable(),
  durationMin: z.number().int(),
  bufferAfterMin: z.number().int(),
  priceCents: MoneyCentsSchema,
  parallelizable: z.boolean(),
  resourceTypeId: IdSchema.nullable(),
  onlineBookable: z.boolean(),
  active: z.boolean(),
  levelPrices: z.array(LevelPriceSchema),
});
export type Service = z.infer<typeof ServiceSchema>;
