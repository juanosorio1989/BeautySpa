"use client";

import type { Agenda, AppointmentSegment, StaffAppointment } from "@beautyspa/contracts";
import type { Locale } from "@beautyspa/i18n";
import { useTranslations } from "next-intl";
import { formatTimeRange } from "@/lib/format";
import { localized } from "@/lib/localized";

const STATUS_STYLE: Record<StaffAppointment["status"], string> = {
  HELD: "bg-chip text-ink",
  BOOKED: "bg-chip text-ink",
  CHECKED_IN: "bg-plum-tint text-plum-hover",
  COMPLETED: "bg-ok-bg text-ok",
  NO_SHOW: "bg-warn-bg text-warn",
  CANCELLED: "bg-chip text-muted line-through",
};

export interface CardProps {
  appointment: StaffAppointment;
  segment: AppointmentSegment;
  /** Set when the appointment has more than one segment. */
  part: { index: number; total: number } | null;
  agenda: Pick<Agenda, "services" | "resources" | "timezone">;
  locale: Locale;
  top: number;
  height: number;
  highlighted: boolean;
  onSelect: (appointmentId: string) => void;
}

export function AppointmentCard({
  appointment: a,
  segment,
  part,
  agenda,
  locale,
  top,
  height,
  highlighted,
  onSelect,
}: CardProps) {
  const t = useTranslations("staff.agenda");
  const service = agenda.services.find((s) => s.id === segment.serviceId);
  const resource = agenda.resources.find((r) => r.id === segment.resourceId);
  const name = a.customer ? (a.customer.name ?? t("unnamedClient")) : t("walkInClient");
  const dim = a.status === "NO_SHOW" || a.status === "CANCELLED";
  const meta = [
    service ? localized(service.name, locale) : "",
    resource?.name ?? "",
    formatTimeRange(segment.startsAt, segment.endsAt, agenda.timezone, locale),
  ].filter(Boolean);

  return (
    <button
      type="button"
      data-appointment-id={a.id}
      onClick={() => onSelect(a.id)}
      style={{ top, height }}
      className={`absolute inset-x-1 flex flex-col gap-0.5 overflow-hidden rounded-[14px] bg-card px-3 py-2 text-left shadow-sm ${
        dim ? "opacity-60" : ""
      } ${highlighted ? "outline outline-[3px] outline-plum" : "border border-line"}`}
    >
      <span className="flex items-center justify-between gap-2">
        <span className="truncate font-semibold">{name}</span>
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_STYLE[a.status]}`}>
          {t(`status.${a.status}`)}
        </span>
      </span>
      <span className="truncate text-[13px] text-muted">{meta.join(" · ")}</span>
      <span className="flex flex-wrap gap-x-2 text-xs">
        {part ? <span className="text-muted">{t("part", part)}</span> : null}
        {a.source === "ONLINE" ? <span className="text-muted">{t("online")}</span> : null}
        {a.confirmedByCustomerAt ? <span className="text-ok">{t("confirmed")}</span> : null}
        {a.customer && !a.customer.reachable ? (
          <span className="rounded-full bg-warn-bg px-2 font-semibold text-warn">{t("noMessages")}</span>
        ) : null}
      </span>
    </button>
  );
}
