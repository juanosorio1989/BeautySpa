"use client";

import type { Agenda, AgendaEmployee } from "@beautyspa/contracts";
import { utcToWall } from "@beautyspa/datetime";
import type { Locale } from "@beautyspa/i18n";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { formatTime } from "@/lib/format";
import { freeGaps } from "@/lib/staff/gaps";
import { AppointmentCard } from "./appointment-card";

export const QUARTER_MS = 15 * 60_000;
/** Height of one 15-minute row. */
export const QUARTER_PX = 32;
export const HEADER_PX = 48;

export const yOf = (instant: number, spanStart: number) => ((instant - spanStart) / QUARTER_MS) * QUARTER_PX;

const iso = (ms: number) => new Date(ms).toISOString();

export function AgendaColumn({
  agenda,
  employee,
  span,
  now,
  locale,
  canBook,
  highlightId,
  onSelect,
}: {
  agenda: Agenda;
  employee: AgendaEmployee;
  span: { start: number; end: number };
  now: number;
  locale: Locale;
  canBook: boolean;
  highlightId: string | null;
  onSelect: (appointmentId: string) => void;
}) {
  const t = useTranslations("staff.agenda");
  const height = yOf(span.end, span.start);

  const cards = agenda.appointments.flatMap((a) => {
    const own = [...a.segments].sort((x, y) => Date.parse(x.startsAt) - Date.parse(y.startsAt));
    return own
      .map((segment, i) => ({ a, segment, part: own.length > 1 ? { index: i + 1, total: own.length } : null }))
      .filter((c) => c.segment.employeeId === employee.id);
  });

  const busy = cards
    .filter((c) => c.a.status !== "CANCELLED" && c.a.status !== "NO_SHOW")
    .map((c) => ({ start: Date.parse(c.segment.startsAt), end: Date.parse(c.segment.blockEndsAt) }));
  const ranges = employee.ranges.map((r) => ({ start: Date.parse(r.start), end: Date.parse(r.end) }));
  const isToday = utcToWall(now, agenda.timezone).date === agenda.date;
  const showNow = isToday && now >= span.start && now <= span.end;
  // On today a gap that already started begins at the next quarter hour; one that ended is dropped.
  const nextQuarter = Math.ceil(now / QUARTER_MS) * QUARTER_MS;
  const gaps = freeGaps(ranges, busy)
    .map((g) => (isToday && g.start < nextQuarter ? { start: nextQuarter, end: g.end } : g))
    .filter((g) => g.end - g.start >= QUARTER_MS);

  return (
    <section aria-label={employee.displayName} className="min-w-[240px] flex-1 basis-0">
      <header
        style={{ height: HEADER_PX }}
        className="flex flex-col justify-center border-b border-line px-2 text-center font-semibold"
      >
        <span className="truncate">{employee.displayName}</span>
        {employee.active ? null : <span className="truncate text-xs font-normal text-warn">{t("inactiveColumn")}</span>}
      </header>
      <div
        style={{
          height,
          backgroundImage: `repeating-linear-gradient(to bottom, transparent 0, transparent ${QUARTER_PX - 1}px, var(--color-line) ${QUARTER_PX - 1}px, var(--color-line) ${QUARTER_PX}px)`,
        }}
        className="relative"
      >
        {ranges.map((r, i) => (
          <div
            key={i}
            aria-hidden
            style={{ top: yOf(r.start, span.start), height: yOf(r.end, span.start) - yOf(r.start, span.start) }}
            className="absolute inset-x-0 bg-card/60"
          />
        ))}
        {canBook
          ? gaps.map((g) => {
              const time = utcToWall(g.start, agenda.timezone).time;
              const range = `${formatTime(iso(g.start), agenda.timezone, locale)} – ${formatTime(iso(g.end), agenda.timezone, locale)}`;
              return (
                <Link
                  key={g.start}
                  href={`/staff/book?date=${agenda.date}&time=${time}&employeeId=${employee.id}`}
                  style={{
                    top: yOf(g.start, span.start) + 2,
                    height: Math.max(44, yOf(g.end, span.start) - yOf(g.start, span.start) - 4),
                  }}
                  className="absolute inset-x-1 flex items-start rounded-[14px] border border-dashed border-line-strong px-3 py-2 text-sm font-medium text-muted"
                >
                  {t("free", { range })}
                </Link>
              );
            })
          : null}
        {cards.map(({ a, segment, part }) => (
          <AppointmentCard
            key={segment.id}
            appointment={a}
            segment={segment}
            part={part}
            agenda={agenda}
            locale={locale}
            top={yOf(Date.parse(segment.startsAt), span.start)}
            height={Math.max(
              44,
              yOf(Date.parse(segment.endsAt), span.start) - yOf(Date.parse(segment.startsAt), span.start),
            )}
            highlighted={highlightId === a.id}
            onSelect={onSelect}
          />
        ))}
        {showNow ? (
          <div
            aria-hidden
            style={{ top: yOf(now, span.start) }}
            className="pointer-events-none absolute inset-x-0 z-10 h-0.5 bg-plum"
          />
        ) : null}
      </div>
    </section>
  );
}
