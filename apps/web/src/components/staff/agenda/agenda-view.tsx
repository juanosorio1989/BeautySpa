"use client";

import { ApiError } from "@beautyspa/api-client";
import type { Agenda } from "@beautyspa/contracts";
import { todayIn } from "@beautyspa/datetime";
import type { Locale } from "@beautyspa/i18n";
import { useLocale, useTranslations } from "next-intl";
import { usePathname, useRouter as useNextRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "@/i18n/navigation";
import { getBrowserApi } from "@/lib/api/browser";
import { formatTime } from "@/lib/format";
import { staffLoginPath } from "@/lib/staff/login-path";
import { dayWindow } from "@/lib/staff/day-window";
import { useMediaQuery } from "@/lib/staff/use-media-query";
import { usePolling } from "@/lib/staff/use-polling";
import { useStaff } from "@/lib/staff/use-staff";
import { useErrorText } from "@/lib/use-error-text";
import { ActionSheet } from "./action-sheet";
import { AgendaColumn, HEADER_PX, QUARTER_MS, yOf } from "./agenda-column";
import { AgendaHeader } from "./agenda-header";
import { EmployeeChips } from "./employee-chips";
import { MoveSheet } from "./move-sheet";

const STORAGE_KEY = "bs-staff-agenda-employees";
const HOUR_MS = 60 * 60_000;
const SWIPE_PX = 60;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function readSelection(): string[] | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    return Array.isArray(parsed) && parsed.every((x) => typeof x === "string") ? (parsed as string[]) : null;
  } catch {
    return null;
  }
}

function writeSelection(ids: string[]) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
  } catch {
    // the filter is a per-device convenience; the agenda works without it
  }
}

export function AgendaView() {
  const t = useTranslations("staff.agenda");
  const tCommon = useTranslations("common");
  const errorText = useErrorText();
  const locale = useLocale() as Locale;
  const staff = useStaff();
  const router = useRouter();
  const nextRouter = useNextRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const wide = useMediaQuery("(min-width: 768px)");
  const dateParam = params.get("date");
  const highlight = params.get("highlight");
  const canBook = staff.role !== "EMPLOYEE";

  // Without ?date= the day is "today" at the salon, so the location timezone is needed first.
  const [zone, setZone] = useState<string | null>(null);
  useEffect(() => {
    if (dateParam && ISO_DATE.test(dateParam)) return;
    let cancelled = false;
    getBrowserApi()
      .public.locations()
      .then(
        (list) => !cancelled && setZone(list[0]?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone),
        () => !cancelled && setZone(Intl.DateTimeFormat().resolvedOptions().timeZone),
      );
    return () => {
      cancelled = true;
    };
  }, [dateParam]);

  const [now, setNow] = useState(() => Date.now());
  const date = dateParam && ISO_DATE.test(dateParam) ? dateParam : zone ? todayIn(zone, now) : null;

  const [agenda, setAgenda] = useState<Agenda | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [includeCancelled, setIncludeCancelled] = useState(false);
  const seq = useRef(0);
  const load = useCallback(async () => {
    if (!date) return;
    const n = ++seq.current;
    try {
      const next = await getBrowserApi().staff.agenda({ date, includeCancelled });
      if (n !== seq.current) return;
      setAgenda(next);
      setNow(Date.now());
      setError(null);
    } catch (err) {
      if (n !== seq.current) return;
      // The web never asks for another employee's agenda, so a 403 means this tab's session is no
      // longer staff (a client signed in in another tab): back to staff login with the notice.
      if (err instanceof ApiError && err.status === 403) {
        nextRouter.replace(staffLoginPath(locale, pathname, params.toString(), true));
        return;
      }
      setError(err);
    }
    // `nextRouter`, `pathname` and `params` only shape the redirect url
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, includeCancelled]);
  useEffect(() => {
    // fetching on mount and when the day or filter changes; state is set after the response
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);
  usePolling(() => void load(), 30_000);

  const [selected, setSelected] = useState<string[] | null>(readSelection);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [sheet, setSheet] = useState<{ id: string; moving: boolean } | null>(null);
  const [changedNotice, setChangedNotice] = useState(false);
  const [expiredFor, setExpiredFor] = useState<string | null>(null);

  const shown = agenda && agenda.date === date ? agenda : null;

  // A new day closes the sheet and drops the notice (adjusting state during render, not in an effect).
  const [sheetDate, setSheetDate] = useState(date);
  if (sheetDate !== date) {
    setSheetDate(date);
    setSheet(null);
    setChangedNotice(false);
  }
  // The open appointment left the loaded agenda (cancelled, moved away): close the sheet for good,
  // so a later poll that brings it back does not reopen it.
  if (sheet && shown && !shown.appointments.some((a) => a.id === sheet.id)) setSheet(null);

  // ?highlight=<id>: reveal the card (its column on phones), outline it for 3 seconds.
  const target = highlight ? shown?.appointments.find((a) => a.id === highlight) : undefined;
  const highlighted = target && expiredFor !== highlight ? target.id : null;
  const targetId = target?.id;
  useEffect(() => {
    if (!targetId || !highlight) return;
    const timer = setTimeout(() => setExpiredFor(highlight), 3000);
    return () => clearTimeout(timer);
  }, [targetId, highlight]);
  useEffect(() => {
    if (!highlighted) return;
    document.querySelector(`[data-appointment-id="${highlighted}"]`)?.scrollIntoView?.({ block: "center" });
  }, [highlighted, activeId, wide]);

  function goTo(next: string) {
    router.replace(`/staff?date=${next}`);
  }

  const employees = shown?.employees ?? [];
  const filtered = employees.filter((e) => !selected || selected.includes(e.id));
  const wideColumns = filtered.length > 0 ? filtered : employees;
  const phoneEmployee = employees.find((e) => e.id === (activeId ?? target?.segments[0]?.employeeId)) ?? employees[0];
  const columns = wide ? wideColumns : phoneEmployee ? [phoneEmployee] : [];

  function toggle(id: string) {
    if (!wide) return setActiveId(id);
    const current = wideColumns.map((e) => e.id);
    const next = current.includes(id) ? current.filter((x) => x !== id) : [...current, id];
    if (next.length === 0) return; // at least one column stays
    setSelected(next);
    writeSelection(next);
  }

  const touchX = useRef<number | null>(null);
  function swipe(endX: number) {
    if (wide || touchX.current === null || !phoneEmployee) return;
    const dx = endX - touchX.current;
    touchX.current = null;
    if (Math.abs(dx) < SWIPE_PX) return;
    const i = employees.indexOf(phoneEmployee);
    const next = employees[i + (dx < 0 ? 1 : -1)];
    if (next) setActiveId(next.id);
  }

  const today = shown ? todayIn(shown.timezone, now) : zone ? todayIn(zone, now) : null;

  let span: { start: number; end: number } | null = null;
  if (shown && columns.length > 0) {
    const base = dayWindow(columns, shown.date, shown.timezone);
    const own = shown.appointments.flatMap((a) => a.segments);
    const starts = [base.start, ...own.map((s) => Date.parse(s.startsAt))];
    const ends = [base.end, ...own.map((s) => Date.parse(s.endsAt))];
    span = {
      start: Math.floor(Math.min(...starts) / QUARTER_MS) * QUARTER_MS,
      end: Math.ceil(Math.max(...ends) / QUARTER_MS) * QUARTER_MS,
    };
  }

  const ticks: number[] = [];
  if (span)
    for (let tick = Math.ceil(span.start / HOUR_MS) * HOUR_MS; tick < span.end; tick += HOUR_MS) ticks.push(tick);

  const sheetAppointment = shown && sheet ? shown.appointments.find((a) => a.id === sheet.id) : undefined;

  return (
    <div className="flex flex-col gap-3 pt-2">
      {date ? (
        <AgendaHeader
          date={date}
          today={today}
          locale={locale}
          canBook={canBook}
          includeCancelled={includeCancelled}
          onDate={goTo}
          onIncludeCancelled={setIncludeCancelled}
        />
      ) : null}
      {employees.length > 1 ? (
        <div className="rounded-[18px] bg-ink px-5 py-3">
          <EmployeeChips
            employees={employees}
            selectedIds={wide ? wideColumns.map((e) => e.id) : phoneEmployee ? [phoneEmployee.id] : []}
            onToggle={toggle}
          />
        </div>
      ) : null}
      {changedNotice ? (
        <p role="status" className="rounded-xl bg-warn-bg p-3 text-sm text-warn">
          {t("changed")}
        </p>
      ) : null}
      {error ? (
        <div role="alert" className="text-sm text-warn">
          <p>{errorText(error)}</p>
          <button
            type="button"
            onClick={() => void load()}
            className="mt-2 min-h-11 rounded-full border border-plum px-5 font-medium"
          >
            {tCommon("retry")}
          </button>
        </div>
      ) : null}
      {!shown && !error ? <p className="text-muted">{t("loading")}</p> : null}
      {shown && span ? (
        <div
          className="flex overflow-x-auto"
          onTouchStart={(e) => (touchX.current = e.touches[0]?.clientX ?? null)}
          onTouchEnd={(e) => swipe(e.changedTouches[0]?.clientX ?? 0)}
        >
          <div aria-hidden className="w-14 shrink-0 text-[13px] text-muted">
            <div style={{ height: HEADER_PX }} />
            <div className="relative" style={{ height: yOf(span.end, span.start) }}>
              {ticks.map((tick) => (
                <span key={tick} style={{ top: yOf(tick, span.start) }} className="absolute -translate-y-1/2 pt-px">
                  {formatTime(new Date(tick).toISOString(), shown.timezone, locale)}
                </span>
              ))}
            </div>
          </div>
          {columns.map((e) => (
            <AgendaColumn
              key={e.id}
              agenda={shown}
              employee={e}
              span={span}
              now={now}
              locale={locale}
              canBook={canBook}
              highlightId={highlighted}
              onSelect={(id) => {
                setChangedNotice(false);
                setSheet({ id, moving: false });
              }}
            />
          ))}
        </div>
      ) : null}
      {shown && sheetAppointment && sheet && !sheet.moving ? (
        <ActionSheet
          appointment={sheetAppointment}
          agenda={shown}
          now={now}
          locale={locale}
          onClose={() => setSheet(null)}
          onChanged={load}
          onConflict={() => setChangedNotice(true)}
          onMove={() => setSheet({ id: sheet.id, moving: true })}
        />
      ) : null}
      {shown && sheetAppointment && sheet?.moving ? (
        <MoveSheet
          appointment={sheetAppointment}
          agenda={shown}
          today={today ?? shown.date}
          locale={locale}
          onClose={() => setSheet(null)}
          onChanged={load}
          onConflict={() => setChangedNotice(true)}
        />
      ) : null}
    </div>
  );
}
