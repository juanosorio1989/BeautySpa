import { ApiError } from "@beautyspa/api-client";

/** i18n key (under the root catalog) for an error; maps by code, never by message text. */
export function errorMessageKey(err: unknown): string {
  if (err instanceof ApiError) return `errors.${err.problem.code}`;
  if (err instanceof TypeError) return "errors.network";
  return "errors.generic";
}

/** Field errors by `path` from a VALIDATION_FAILED problem. */
export function fieldErrors(err: unknown): Record<string, string> {
  if (!(err instanceof ApiError)) return {};
  const out: Record<string, string> = {};
  for (const e of err.problem.errors ?? []) out[e.path] = e.message;
  return out;
}
