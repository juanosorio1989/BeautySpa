import { BadRequestException, ConflictException, NotFoundException } from "@nestjs/common";

/** 400 `VALIDATION_FAILED` for a body field that names an unknown or other-org row. */
export function invalidRef(path: string, message: string): BadRequestException {
  return new BadRequestException({
    code: "VALIDATION_FAILED",
    message: "Validation failed",
    errors: [{ path, message }],
  });
}

/** 404 `NOT_FOUND` for an unknown or other-org row named in the path. */
export function notFound(what: string): NotFoundException {
  return new NotFoundException({ code: "NOT_FOUND", message: `${what} not found` });
}

/** 409 `CONFLICT` for a delete blocked by rows that reference it. */
export function inUse(what: string): ConflictException {
  return new ConflictException({ code: "CONFLICT", message: `${what} is in use` });
}

/** 409 `CONFLICT` for a write that the row's current state does not allow. */
export function conflict(message: string): ConflictException {
  return new ConflictException({ code: "CONFLICT", message });
}

/** 409 `SLOT_TAKEN`: the requested time is no longer free; the client refreshes slots. */
export function slotTaken(message = "That time is no longer available"): ConflictException {
  return new ConflictException({ code: "SLOT_TAKEN", message });
}

/** 409 `HOLD_EXPIRED`: the hold was released before it was confirmed. */
export function holdExpired(): ConflictException {
  return new ConflictException({ code: "HOLD_EXPIRED", message: "The hold has expired" });
}

/** 409 `OUTSIDE_CANCEL_WINDOW`: too close to the start for a customer to cancel or reschedule. */
export function outsideCancelWindow(): ConflictException {
  return new ConflictException({
    code: "OUTSIDE_CANCEL_WINDOW",
    message: "Too late to change this appointment online",
  });
}
