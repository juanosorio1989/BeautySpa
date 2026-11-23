import { useTranslations } from "next-intl";
import type { Appointment, PublicEmployee, PublicService } from "@beautyspa/contracts";
import type { Locale } from "@beautyspa/i18n";
import { formatPrice } from "@/lib/format";
import { localized } from "@/lib/localized";

/** One line per segment: service with professional, and its price. */
export function SegmentLines({
  segments,
  services,
  employees,
  locale,
}: {
  segments: Appointment["segments"];
  services: PublicService[];
  employees: PublicEmployee[];
  locale: Locale;
}) {
  const t = useTranslations("booking");
  return (
    <ul className="flex flex-col gap-3.5">
      {segments.map((seg) => (
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
  );
}
