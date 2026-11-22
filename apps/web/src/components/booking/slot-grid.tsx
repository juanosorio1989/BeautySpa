import type { Slot } from "@beautyspa/contracts";
import type { Locale } from "@beautyspa/i18n";
import { formatTime } from "@/lib/format";

export function SlotGrid({
  slots,
  selected,
  onSelect,
  timezone,
  locale,
}: {
  slots: Slot[];
  selected: Slot | null;
  onSelect: (slot: Slot) => void;
  timezone: string;
  locale: Locale;
}) {
  return (
    <div className="grid grid-cols-3 gap-2.5">
      {slots.map((slot, i) => {
        const active = slot === selected;
        return (
          <button
            key={`${slot.startsAt}-${i}`}
            type="button"
            aria-pressed={active}
            onClick={() => onSelect(slot)}
            className={`min-h-12 rounded-xl text-[15px] font-semibold ${
              active
                ? "border-2 border-plum bg-plum-tint text-plum-hover"
                : "border border-line-strong bg-card text-ink"
            }`}
          >
            {formatTime(slot.startsAt, timezone, locale)}
          </button>
        );
      })}
    </div>
  );
}
