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
