import { DEFAULT_LOCATION_SETTINGS, LocationSettingsSchema, type LocationSettings } from "@beautyspa/contracts";

/**
 * `{ ...DEFAULT_LOCATION_SETTINGS, ...stored }` validated key by key: any
 * missing or invalid stored key falls back to its default.
 */
export function readLocationSettings(json: unknown): LocationSettings {
  const stored =
    json !== null && typeof json === "object" && !Array.isArray(json) ? (json as Record<string, unknown>) : {};
  const out: Record<string, unknown> = { ...DEFAULT_LOCATION_SETTINGS };
  for (const key of Object.keys(DEFAULT_LOCATION_SETTINGS) as (keyof LocationSettings)[]) {
    if (!(key in stored)) continue;
    const candidate = { ...DEFAULT_LOCATION_SETTINGS, [key]: stored[key] };
    if (LocationSettingsSchema.safeParse(candidate).success) out[key] = stored[key];
  }
  return LocationSettingsSchema.parse(out);
}
