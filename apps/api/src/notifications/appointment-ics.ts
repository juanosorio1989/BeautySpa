import type { IcsEvent } from "./ics.js";
import type { LoadedAppointment } from "./message-context.service.js";
import type { MessageContext } from "./templates/types.js";

/**
 * The appointment's calendar event, shared by the email `.ics` and the manage link download:
 * UID `appointment-<id>@beautyspa`, SEQUENCE = `manage_version`, SUMMARY "services — salon",
 * LOCATION the one-line address, DESCRIPTION the professionals and the salon phone (then `url`).
 */
export function appointmentIcsEvent(
  a: LoadedAppointment,
  ctx: MessageContext,
  opts: { dtstamp: Date; url: string; status: IcsEvent["status"] },
): IcsEvent {
  const professionals = [...new Set(ctx.services.map((s) => s.employeeName).filter((n) => n.length > 0))];
  return {
    uid: `appointment-${a.id}@beautyspa`,
    sequence: a.manageVersion,
    dtstamp: opts.dtstamp,
    start: a.start,
    end: a.end,
    summary: `${ctx.services.map((s) => s.name).join(", ")} — ${ctx.salonName}`,
    location: ctx.address,
    description: [professionals.join(", "), ctx.salonPhone ?? ""].filter((s) => s.length > 0).join("\n"),
    url: opts.url,
    status: opts.status,
  };
}
