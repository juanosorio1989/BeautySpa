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

export const yOf = (instant: number, windowStart: number) => ((instant - windowStart) / QUARTER_MS) * QUARTER_PX;

const iso = (ms: number) => new Date(ms).toISOString();

export function AgendaColumn({
  agenda,
  employee,
  window,
  now,
  locale,
  canBook,
  highlightId,
  onSelect,
}: {
  agenda: Agenda;
  employee: AgendaEmployee;
  window: { start: number; end: number };
  now: number;
  locale: Locale;
  canBook: boolean;
  highlightId: string | null;
  onSelect: (appointmentId: string) => void;
}) {
  const t = useTranslations("staff.agenda");
  const height = yOf(window.end, window.start);

  const cards = agenda.appointments.flatMap((a) => {
    const own = [...a.segments].sort((x, y) => Date.parse(x.startsAt) - Date.parse(y.startsAt));
    return own
      .map((segment, i) => ({ a, segment, part: own.length > 1 ? { index: i + 1, total: own.length } : null }))
      .filter((c) => c.segment.employeeId === employee.id);
  });

  const busy = cards
    .filter((c) => c.a.status !== "CANCELLED" && c.a.status !== "NO_SHOW")
    .map((c) => ({ start: Date.parse(c.segment.startsAt), end: Date.parse(c.segment.endsAt) }));
  const ranges = employee.ranges.map((r) => ({ start: Date.parse(r.start), end: Date.parse(r.end) }));
  const gaps = freeGaps(ranges, busy);
  const showNow = now >= window.start && now <= window.end && utcToWall(now, agenda.timezone).date === agenda.date;

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
            style={{ top: yOf(r.start, window.start), height: yOf(r.end, window.start) - yOf(r.start, window.start) }}
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
                    top: yOf(g.start, window.start) + 2,
                    height: Math.max(44, yOf(g.end, window.start) - yOf(g.start, window.start) - 4),
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
            top={yOf(Date.parse(segment.startsAt), window.start)}
            height={Math.max(
              44,
              yOf(Date.parse(segment.endsAt), window.start) - yOf(Date.parse(segment.startsAt), window.start),
            )}
            highlighted={highlightId === a.id}
            onSelect={onSelect}
          />
        ))}
        {showNow ? (
          <div
            aria-hidden
            style={{ top: yOf(now, window.start) }}
            className="pointer-events-none absolute inset-x-0 z-10 h-0.5 bg-plum"
          />
        ) : null}
      </div>
    </section>
  );
}
