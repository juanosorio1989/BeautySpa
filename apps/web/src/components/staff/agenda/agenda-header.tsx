"use client";

import type { Locale } from "@beautyspa/i18n";
import { addDays } from "@beautyspa/datetime";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { dayLabel } from "@/lib/booking/date-strip";

const BTN = "flex min-h-11 min-w-11 items-center justify-center rounded-xl px-3 text-sm font-semibold";

export function AgendaHeader({
  date,
  today,
  locale,
  canBook,
  includeCancelled,
  onDate,
  onIncludeCancelled,
}: {
  date: string;
  today: string | null;
  locale: Locale;
  canBook: boolean;
  includeCancelled: boolean;
  onDate: (date: string) => void;
  onIncludeCancelled: (value: boolean) => void;
}) {
  const t = useTranslations("staff.agenda");
  return (
    <div className="flex flex-col gap-3 rounded-[18px] bg-ink px-5 pb-3.5 pt-4 text-white">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1">
          <button
            type="button"
            aria-label={t("previousDay")}
            onClick={() => onDate(addDays(date, -1))}
            className={`${BTN} border border-[#5E534D]`}
          >
            ‹
          </button>
          <h1 className="px-2 font-heading text-xl font-semibold">{dayLabel(date, locale).full}</h1>
          <button
            type="button"
            aria-label={t("nextDay")}
            onClick={() => onDate(addDays(date, 1))}
            className={`${BTN} border border-[#5E534D]`}
          >
            ›
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="date"
            aria-label={t("pickDate")}
            value={date}
            onChange={(e) => e.target.value && onDate(e.target.value)}
            className="min-h-11 rounded-xl border border-[#5E534D] bg-transparent px-2 text-sm text-white"
          />
          {today && today !== date ? (
            <button type="button" onClick={() => onDate(today)} className={`${BTN} border border-[#5E534D]`}>
              {t("today")}
            </button>
          ) : null}
          {canBook ? (
            <>
              <Link href={`/staff/book?date=${date}`} className={`${BTN} bg-white text-ink hover:text-ink`}>
                {t("new")}
              </Link>
              <Link href="/staff/walk-in" className={`${BTN} bg-white text-ink hover:text-ink`}>
                {t("walkIn")}
              </Link>
            </>
          ) : null}
        </div>
      </div>
      <label className="flex min-h-11 items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={includeCancelled}
          onChange={(e) => onIncludeCancelled(e.target.checked)}
          className="size-5"
        />
        {t("showCancelled")}
      </label>
    </div>
  );
}
