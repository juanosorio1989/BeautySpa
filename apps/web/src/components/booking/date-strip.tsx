import { useTranslations } from "next-intl";
import type { Locale } from "@beautyspa/i18n";
import { dayLabel } from "@/lib/booking/date-strip";

/** Horizontally scrollable day buttons, seven visible at a time. */
export function DateStrip({
  dates,
  selected,
  onSelect,
  locale,
}: {
  dates: string[];
  selected: string;
  onSelect: (date: string) => void;
  locale: Locale;
}) {
  const t = useTranslations("booking.time");
  return (
    <div
      role="group"
      aria-label={t("date")}
      className="grid snap-x auto-cols-[max(44px,calc((100%-48px)/7))] grid-flow-col gap-2 overflow-x-auto pb-2"
    >
      {dates.map((date, i) => {
        const { weekday, day } = dayLabel(date, locale);
        const active = date === selected;
        return (
          <button
            key={date}
            type="button"
            aria-pressed={active}
            aria-label={`${weekday} ${day}`}
            onClick={() => onSelect(date)}
            className={`flex min-h-[60px] min-w-11 snap-start flex-col items-center justify-center gap-0.5 rounded-[14px] py-2 ${
              active ? "bg-plum text-white" : "border border-line-strong bg-card text-ink"
            }`}
          >
            <span className={`text-xs ${active ? "" : "text-muted"}`}>{i === 0 ? t("today") : weekday}</span>
            <span className="text-[17px] font-semibold">{day}</span>
          </button>
        );
      })}
    </div>
  );
}
