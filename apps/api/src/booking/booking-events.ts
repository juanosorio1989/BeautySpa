import { Injectable, Logger } from "@nestjs/common";

/**
 * Notification port for appointment lifecycle events. Callers invoke it only after the write
 * transaction has committed, through `notifyAfterCommit`, so a failing adapter never fails or
 * rolls back the request. `BookingModule` binds it to `QueueBookingEvents` (enqueues notification `send` jobs).
 */
export abstract class BookingEvents {
  abstract booked(appointmentId: string): Promise<void>;
  abstract changed(appointmentId: string): Promise<void>;
  abstract cancelled(appointmentId: string): Promise<void>;
}

/** No-op adapter for unit tests: logs `booking.<event> <id>` at debug level. */
@Injectable()
export class LoggingBookingEvents extends BookingEvents {
  private readonly logger = new Logger(LoggingBookingEvents.name);

  booked(appointmentId: string): Promise<void> {
    return this.log("booked", appointmentId);
  }

  changed(appointmentId: string): Promise<void> {
    return this.log("changed", appointmentId);
  }

  cancelled(appointmentId: string): Promise<void> {
    return this.log("cancelled", appointmentId);
  }

  private log(event: string, appointmentId: string): Promise<void> {
    this.logger.debug(`booking.${event} ${appointmentId}`);
    return Promise.resolve();
  }
}

/**
 * Runs `fn` (a call on `events`) after commit. Any error is logged with the adapter's name and
 * swallowed: the write already succeeded and the response must not change.
 */
export async function notifyAfterCommit(events: BookingEvents, logger: Logger, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (err) {
    const e = err instanceof Error ? err : new Error(String(err));
    logger.error(`${events.constructor.name} failed after commit: ${e.message}`, e.stack);
  }
}
