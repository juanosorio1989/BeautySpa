import { useTranslations } from "next-intl";
import type { PublicLocation } from "@beautyspa/contracts";
import type { Locale } from "@beautyspa/i18n";

const DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
const DISPLAY_ORDER = [1, 2, 3, 4, 5, 6, 0] as const;

/** Wall-clock "HH:mm" (already in the location timezone) shown in the locale's style. */
function wall(time: string, locale: Locale): string {
  const [h, m] = time.split(":").map(Number) as [number, number];
  return new Intl.DateTimeFormat(locale === "es" ? "es-US" : "en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(2001, 0, 1, h % 24, m)));
}

export function LocationHours({ location, locale }: { location: PublicLocation; locale: Locale }) {
  const t = useTranslations("location");

  return (
    <div className="space-y-6">
      <section>
        <h2 className="font-heading text-xl">{t("address")}</h2>
        {location.address ? (
          <p className="mt-2">
            {location.address}{" "}
            <a
              href={`https://maps.google.com/?q=${encodeURIComponent(location.address)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-11 items-center font-medium underline"
            >
              {t("openMap")}
            </a>
          </p>
        ) : (
          <p className="mt-2 text-muted">{t("noAddress")}</p>
        )}
      </section>
      {location.phone ? (
        <section>
          <h2 className="font-heading text-xl">{t("phone")}</h2>
          <a href={`tel:${location.phone}`} className="mt-2 inline-flex min-h-11 items-center font-medium underline">
            {location.phone}
          </a>
        </section>
      ) : null}
      <section>
        <h2 className="font-heading text-xl">{t("hours")}</h2>
        <dl className="mt-2 divide-y divide-line rounded-2xl border border-line bg-card">
          {DISPLAY_ORDER.map((d) => {
            const ranges = location.hours
              .filter((h) => h.weekday === d)
              .sort((a, b) => a.start.localeCompare(b.start))
              .map((h) => t("hoursRange", { start: wall(h.start, locale), end: wall(h.end, locale) }));
            return (
              <div key={d} className="flex justify-between gap-4 px-4 py-3">
                <dt className="font-medium">{t(`weekdays.${DAYS[d]}`)}</dt>
                <dd className={ranges.length ? "" : "text-muted"}>{ranges.length ? ranges.join(", ") : t("closed")}</dd>
              </div>
            );
          })}
        </dl>
      </section>
    </div>
  );
}
