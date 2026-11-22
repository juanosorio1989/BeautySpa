import { Inject, Injectable } from "@nestjs/common";
import type { Queue } from "bullmq";
import { BookingEvents } from "../booking/booking-events.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { NOTIFICATIONS_QUEUE_TOKEN } from "../queue/queue.module.js";
import { SEND_JOB_OPTIONS, sendJobId, type SendJob } from "../queue/queue-names.js";
import { TenancyService } from "../tenancy/tenancy.service.js";
import type { TemplateKey } from "./templates/types.js";

/**
 * Production `BookingEvents`: adds one `send` job per event to queue `notifications`, with the
 * appointment's `manageVersion` read right after commit and the deterministic `sendJobId`.
 * Walk-ins and appointments without a customer are skipped. Errors propagate to `notifyAfterCommit`,
 * which logs and swallows them.
 */
@Injectable()
export class QueueBookingEvents extends BookingEvents {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenancy: TenancyService,
    @Inject(NOTIFICATIONS_QUEUE_TOKEN) private readonly queue: Queue,
  ) {
    super();
  }

  booked(appointmentId: string): Promise<void> {
    return this.enqueue(appointmentId, "appointment.confirmed");
  }

  changed(appointmentId: string): Promise<void> {
    return this.enqueue(appointmentId, "appointment.changed");
  }

  cancelled(appointmentId: string): Promise<void> {
    return this.enqueue(appointmentId, "appointment.cancelled");
  }

  private async enqueue(appointmentId: string, templateKey: TemplateKey): Promise<void> {
    const organizationId = await this.tenancy.getOrgId();
    const appt = await this.prisma.appointment.findFirst({
      where: { id: appointmentId, organizationId },
      select: { manageVersion: true, source: true, customerId: true },
    });
    if (!appt || appt.source === "WALK_IN" || appt.customerId === null) return;
    const job: SendJob = { appointmentId, templateKey, manageVersion: appt.manageVersion };
    await this.queue.add("send", job, { ...SEND_JOB_OPTIONS, jobId: sendJobId(job) });
  }
}
