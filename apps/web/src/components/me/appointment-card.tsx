import { useTranslations } from "next-intl";
import type { Appointment, PublicEmployee, PublicLocation, PublicService } from "@beautyspa/contracts";
import type { Locale } from "@beautyspa/i18n";
import { AppointmentSummary } from "@/components/booking/appointment-summary";
import { Link } from "@/i18n/navigation";
import { canChangeOnline } from "@/lib/me/window";
import { CallSalon } from "./call-salon";

const BUTTON = "flex min-h-11 items-center justify-center rounded-xl px-[18px] text-[15px] font-semibold";

interface Props {
  appointment: Appointment;
  services: PublicService[];
  employees: PublicEmployee[];
  location: PublicLocation;
  locale: Locale;
  kind: "upcoming" | "past";
  nowMs: number;
  onCancel: (appointment: Appointment) => void;
  onBookAgain: (appointment: Appointment) => void;
  bookingAgain: boolean;
}

/** One appointment: summary, customer-visible note/reason and the actions that fit its kind. */
export function AppointmentCard({
  appointment,
  services,
  employees,
  location,
  locale,
  kind,
  nowMs,
  onCancel,
  onBookAgain,
  bookingAgain,
}: Props) {
  const t = useTranslations("me");
  const changeable = canChangeOnline(appointment.startsAt, location.booking.cancelWindowHours, nowMs);
  return (
    <article className="flex flex-col gap-3">
      {kind === "past" ? (
        <span className="self-start rounded-full bg-chip px-3 py-1 text-[13px] font-semibold text-ink">
          {t(`status.${appointment.status}`)}
        </span>
      ) : null}
      <AppointmentSummary
        appointment={appointment}
        services={services}
        employees={employees}
        location={location}
        locale={locale}
      />
      {appointment.notes ? <p className="text-sm text-muted">{t("note", { note: appointment.notes })}</p> : null}
      {appointment.cancelReason ? (
        <p className="text-sm text-muted">{t("cancelReason", { reason: appointment.cancelReason })}</p>
      ) : null}
      {kind === "upcoming" ? (
        changeable ? (
          <div className="flex gap-2.5">
            <button
              type="button"
              onClick={() => onCancel(appointment)}
              className={`${BUTTON} border border-plum bg-card text-plum`}
            >
              {t("cancel")}
            </button>
            <Link
              href={`/me/appointments/${appointment.id}/reschedule`}
              className={`${BUTTON} bg-plum text-white no-underline hover:bg-plum-hover hover:text-white`}
            >
              {t("changeTime")}
            </Link>
          </div>
        ) : (
          <CallSalon phone={location.phone} />
        )
      ) : (
        <button
          type="button"
          disabled={bookingAgain}
          onClick={() => onBookAgain(appointment)}
          className={`${BUTTON} self-start border border-plum bg-card text-plum disabled:cursor-not-allowed disabled:opacity-60`}
        >
          {bookingAgain ? t("bookingAgain") : t("bookAgain")}
        </button>
      )}
    </article>
  );
}
