"use client";

import type { Slot } from "@beautyspa/contracts";
import type { Locale } from "@beautyspa/i18n";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { formatTime } from "@/lib/format";

export const FIRST_SLOTS = 3;

function who(slot: Slot, names: Map<string, string>): string {
  return [...new Set(slot.segments.map((s) => names.get(s.employeeId) ?? ""))].filter(Boolean).join(" · ");
}

/** First 3 times, "More times" for the day, and "Other time…" (override) as the last tile. */
export function StaffSlotList({
  slots,
  selected,
  onSelect,
  timezone,
  locale,
  employeeNames,
  other,
  onOther,
}: {
  slots: Slot[];
  selected: Slot | null;
  onSelect: (slot: Slot) => void;
  timezone: string;
  locale: Locale;
  employeeNames: Map<string, string>;
  /** True while the list shows override times (the whole day). */
  other: boolean;
  onOther: (value: boolean) => void;
}) {
  const t = useTranslations("staff.book");
  const [more, setMore] = useState(false);
  const shown = other || more ? slots : slots.slice(0, FIRST_SLOTS);

  return (
    <div className="grid grid-cols-2 gap-2">
      {shown.map((slot) => {
        const active = slot === selected;
        return (
          <button
            key={slot.startsAt + slot.segments.map((s) => s.employeeId).join()}
            type="button"
            aria-pressed={active}
            onClick={() => onSelect(slot)}
            className={`flex min-h-14 flex-col items-center justify-center gap-0.5 rounded-xl ${
              active
                ? "border-2 border-plum bg-plum-tint text-plum-hover"
                : "border border-line-strong bg-card text-ink"
            }`}
          >
            <span className="text-[15px] font-semibold">{formatTime(slot.startsAt, timezone, locale)}</span>
            <span className={`text-xs ${active ? "" : "text-muted"}`}>
              {slot.outsideHours ? t("outsideTag") : who(slot, employeeNames)}
            </span>
          </button>
        );
      })}
      {!other && !more && slots.length > FIRST_SLOTS ? (
        <button
          type="button"
          onClick={() => setMore(true)}
          className="min-h-14 rounded-xl border border-line-strong bg-card text-[15px] font-semibold"
        >
          {t("moreTimes")}
        </button>
      ) : null}
      <button
        type="button"
        onClick={() => onOther(!other)}
        className="flex min-h-14 flex-col items-center justify-center gap-0.5 rounded-xl border border-line-strong bg-card"
      >
        <span className="text-[15px] font-semibold">{other ? t("normalTimes") : t("otherTime")}</span>
        {other ? null : <span className="text-xs text-muted">{t("otherTimeHint")}</span>}
      </button>
    </div>
  );
}
