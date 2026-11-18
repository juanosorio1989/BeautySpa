import { AvailabilityError } from "./errors";
import type { ServiceInput } from "./types";

export function findServiceOrThrow(services: ServiceInput[], id: string): ServiceInput {
  const s = services.find((x) => x.id === id);
  if (!s) throw new AvailabilityError("UNKNOWN_SERVICE", `unknown service ${id}`);
  return s;
}
