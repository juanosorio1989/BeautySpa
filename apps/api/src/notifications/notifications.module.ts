import { Module } from "@nestjs/common";
import { QueueBookingEvents } from "./queue-booking-events.js";

/** Notification producers for the API process; `BookingModule` binds `BookingEvents` to `QueueBookingEvents`. */
@Module({ providers: [QueueBookingEvents], exports: [QueueBookingEvents] })
export class NotificationsModule {}
