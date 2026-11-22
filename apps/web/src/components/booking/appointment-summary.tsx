import { useTranslations } from "next-intl";
import type { Appointment, PublicEmployee, PublicLocation, PublicService } from "@beautyspa/contracts";
import type { Locale } from "@beautyspa/i18n";
import { formatDate, formatPrice, formatTimeRange } from "@/lib/format";
import { localized } from "@/lib/localized";

/** Date, time range, services with professionals and prices, total and address. Shared with the client area. */
export function AppointmentSummary({
  appointment,
  services,
  employees,
  location,
  locale,
}: {
  appointment: Appointment;
  services: PublicService[];
  employees: PublicEmployee[];
  location: PublicLocation;
  locale: Locale;
}) {
  const t = useTranslations("booking");
  const tz = location.timezone;
  return (
    <section className="flex flex-col gap-3.5 rounded-[18px] border border-line bg-card p-[18px]">
      <div className="flex flex-col gap-0.5">
        <span className="font-heading text-xl font-semibold">
          {formatDate(appointment.startsAt, tz, locale, "long")}
        </span>
        <span className="text-[15px] text-ink">
          {formatTimeRange(appointment.startsAt, appointment.endsAt, tz, locale)}
        </span>
      </div>
      <hr className="border-line" />
      <ul className="flex flex-col gap-3.5">
        {appointment.segments.map((seg) => (
          <li key={seg.id} className="flex justify-between gap-3 text-[15px]">
            <span>
              {t("summary.line", {
                service: localized(services.find((s) => s.id === seg.serviceId)?.name ?? null, locale),
                employee: employees.find((e) => e.id === seg.employeeId)?.displayName ?? t("time.yourProfessional"),
              })}
            </span>
            <span>{formatPrice(seg.priceCents, locale)}</span>
          </li>
        ))}
      </ul>
      <hr className="border-line" />
      <div className="flex justify-between text-[15px] font-semibold">
        <span>{t("summary.total")}</span>
        <span>{formatPrice(appointment.totalPriceCents, locale)}</span>
      </div>
      {location.address ? <p className="text-[13px] text-muted">{location.address}</p> : null}
    </section>
  );
}
