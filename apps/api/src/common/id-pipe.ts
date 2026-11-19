import { ZodValidationPipe } from "nestjs-zod";
import { IdSchema } from "@beautyspa/contracts";

/** Validates a `:id` path param as a UUID (400 otherwise). */
export const IdPipe = new ZodValidationPipe(IdSchema);
