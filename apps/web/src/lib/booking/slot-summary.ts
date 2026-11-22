import type { PublicEmployee, PublicService, Slot } from "@beautyspa/contracts";
import { en, es, type Locale } from "@beautyspa/i18n";
import { localized } from "@/lib/localized";

export interface SlotSummary {
  lines: { serviceName: string; employeeName: string; priceCents: number }[];
  totalCents: number;
  parallel: boolean;
}

const FALLBACK: Record<Locale, string> = {
  en: en.booking.time.yourProfessional,
  es: es.booking.time.yourProfessional,
};

/** Display summary of a slot; `parallel` is derived from segment overlap, not computed by web. */
export function slotSummary(
  slot: Slot,
  services: PublicService[],
  employees: PublicEmployee[],
  locale: Locale,
): SlotSummary {
  const lines = slot.segments.map((seg) => ({
    serviceName: localized(services.find((s) => s.id === seg.serviceId)?.name ?? null, locale),
    employeeName: employees.find((e) => e.id === seg.employeeId)?.displayName ?? FALLBACK[locale],
    priceCents: seg.priceCents,
  }));
  const spans = slot.segments.map((s) => [Date.parse(s.startsAt), Date.parse(s.endsAt)] as const);
  const parallel = spans.some(([aStart, aEnd], i) =>
    spans.some(([bStart, bEnd], j) => j > i && aStart < bEnd && bStart < aEnd),
  );
  return { lines, totalCents: lines.reduce((sum, l) => sum + l.priceCents, 0), parallel };
}
