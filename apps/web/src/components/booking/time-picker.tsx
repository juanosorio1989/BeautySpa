"use client";

import { ApiError } from "@beautyspa/api-client";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import type { PublicEmployee, PublicLocation, PublicService, ServiceChoice, Slot } from "@beautyspa/contracts";
import type { Locale } from "@beautyspa/i18n";
import { useRouter } from "@/i18n/navigation";
import { getBrowserApi } from "@/lib/api/browser";
import { dateStrip, todayIn } from "@/lib/booking/date-strip";
import { holdSlot } from "@/lib/booking/hold-slot";
import { slotSummary } from "@/lib/booking/slot-summary";
import { useBookingStore } from "@/lib/booking/store";
import { errorMessageKey } from "@/lib/errors";
import { formatDate, formatPrice, formatTimeRange } from "@/lib/format";
import { localized } from "@/lib/localized";
import { BookingFooter } from "./booking-footer";
import { DateStrip } from "./date-strip";
import { SlotGrid } from "./slot-grid";

const NEXT_DAY_LIMIT = 14;

export interface TimePickerProps {
  locale: Locale;
  location: PublicLocation;
  /** The selected services, in order. */
  services: PublicService[];
  employees: PublicEmployee[];
  /** Must keep its identity between renders unless the choices change (it keys the availability fetch). */
  choices: ServiceChoice[];
  onChoiceChange: (serviceId: string, employeeId: string | "ANY") => void;
  date: string | null;
  /** Also called by the next-day search; the found day's slots are cached so the date change does not refetch. */
  onDateChange: (date: string) => void;
  /** Reschedule: the appointment whose own time must not block the search. */
  excludeAppointmentId?: string;
  /** Default: hold the slot and go to step 3. */
  onPick?: (slot: Slot) => Promise<void>;
  pickLabel?: string;
}

type Result = { key: string; slots?: Slot[]; errorKey?: string };

export function TimePicker({
  locale,
  location,
  services,
  employees,
  choices,
  onChoiceChange,
  date,
  onDateChange,
  excludeAppointmentId,
  onPick,
  pickLabel,
}: TimePickerProps) {
  const t = useTranslations("booking.time");
  const tAll = useTranslations();
  const router = useRouter();
  const store = useBookingStore();
  const timezone = location.timezone;

  const [today] = useState(() => todayIn(timezone, Date.now()));
  const strip = dateStrip(today, location.booking.bookingHorizonDays);
  const active = date && strip.includes(date) ? date : (strip[0] ?? today);

  const [refresh, setRefresh] = useState(0);
  const [result, setResult] = useState<Result | null>(null);
  const [picked, setPicked] = useState<Slot | null>(null);
  const [busy, setBusy] = useState(false);
  const [noticeAt, setNoticeAt] = useState<string | null>(null);
  const [pickError, setPickError] = useState<string | null>(null);
  const [noNextFor, setNoNextFor] = useState<string | null>(null);
  const [searchingAt, setSearchingAt] = useState<string | null>(null);
  const cache = useRef<Result | null>(null);
  const searchToken = useRef(0);

  // `viewKey` identifies what the person is looking at; `key` also changes on a forced refetch.
  const keyFor = (d: string, n = refresh) => `${d}|${n}|${excludeAppointmentId ?? ""}|${JSON.stringify(choices)}`;
  const viewKey = keyFor(active, 0);
  const key = keyFor(active);
  const notice = noticeAt === viewKey ? t("slotTaken") : null;
  const searching = searchingAt === viewKey;
  const loading = result?.key !== key;
  const slots = !loading ? result?.slots : undefined;
  const selected = picked && slots?.includes(picked) ? picked : null;

  const save = (r: Result) => {
    cache.current = r;
    setResult(r);
  };

  useEffect(() => {
    if (cache.current?.key === key) {
      // already fetched by the next-day search; show it now that the date really changed
      setResult(cache.current);
      return;
    }
    let cancelled = false;
    getBrowserApi()
      .booking.availability({ locationId: location.id, services: choices, date: active, excludeAppointmentId })
      .then(
        (list) => !cancelled && save({ key, slots: list }),
        (err: unknown) => !cancelled && save({ key, errorKey: errorMessageKey(err) }),
      );
    return () => {
      cancelled = true;
    };
    // `key` encodes every other input
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, location.id]);

  // Leaving the day (or the choices) cancels a running next-day search.
  useEffect(() => {
    const token = searchToken;
    return () => {
      token.current++;
      setSearchingAt(null);
    };
  }, [viewKey]);

  const message = (errorKey: string) =>
    tAll.has(errorKey as never) ? tAll(errorKey as never) : tAll("errors.generic");

  async function nextDay() {
    const token = ++searchToken.current;
    const startedAt = viewKey;
    setSearchingAt(viewKey);
    const from = strip.indexOf(active);
    const candidates = strip.slice(from + 1, from + 1 + NEXT_DAY_LIMIT);
    try {
      for (const d of candidates) {
        const found = await getBrowserApi().booking.availability({
          locationId: location.id,
          services: choices,
          date: d,
          excludeAppointmentId,
        });
        if (token !== searchToken.current) return;
        if (found.length > 0) {
          cache.current = { key: keyFor(d), slots: found };
          onDateChange(d);
          return;
        }
      }
      setNoNextFor(viewKey);
    } catch (err) {
      if (token === searchToken.current) save({ key, errorKey: errorMessageKey(err) });
    } finally {
      setSearchingAt((current) => (current === startedAt ? null : current));
    }
  }

  function taken() {
    setNoticeAt(viewKey);
    setPicked(null);
    setRefresh((r) => r + 1);
  }

  async function pick() {
    if (!selected) return;
    setBusy(true);
    setNoticeAt(null);
    setPickError(null);
    try {
      if (onPick) {
        await onPick(selected);
        return;
      }
      const outcome = await holdSlot(
        getBrowserApi(),
        { hold: store.hold, setHold: store.setHold, clearHold: store.clearHold },
        selected,
        { locationId: location.id, onError: (err) => setPickError(errorMessageKey(err)) },
      );
      if (outcome === "held") {
        store.setDate(active); // clears the slot, so set the slot after
        store.setSlot(selected);
        router.push("/book/details");
      } else if (outcome === "taken") taken();
    } catch (err) {
      if (err instanceof ApiError && err.problem.code === "SLOT_TAKEN") taken();
      else setPickError(errorMessageKey(err));
    } finally {
      setBusy(false);
    }
  }

  const summary = selected ? slotSummary(selected, services, employees, locale) : null;
  const errorKey = result?.key === key ? result.errorKey : undefined;
  const shownError = pickError ?? errorKey;

  return (
    <div className="mx-auto max-w-[480px]">
      <div className="flex flex-col gap-3.5 px-5">
        {services.map((service) => {
          const current = choices.find((c) => c.serviceId === service.id)?.employeeId ?? "ANY";
          const name = localized(service.name, locale);
          const options = employees.filter((e) => e.serviceIds.includes(service.id));
          return (
            <section key={service.id} role="group" aria-label={name} className="flex flex-col gap-2">
              <div className="text-[13px] font-semibold uppercase text-muted">{name}</div>
              <div className="flex flex-wrap gap-2">
                {[{ id: "ANY", label: t("any") }, ...options.map((e) => ({ id: e.id, label: e.displayName }))].map(
                  (o) => (
                    <button
                      key={o.id}
                      type="button"
                      aria-pressed={o.id === current}
                      onClick={() => onChoiceChange(service.id, o.id)}
                      className={`min-h-11 rounded-full px-3.5 text-sm ${
                        o.id === current
                          ? "bg-ink font-semibold text-white"
                          : "border border-line-strong bg-card font-medium text-ink"
                      }`}
                    >
                      {o.label}
                    </button>
                  ),
                )}
              </div>
            </section>
          );
        })}
      </div>
      <div className="px-5 pb-2.5 pt-[18px]">
        <DateStrip dates={strip} selected={active} onSelect={onDateChange} locale={locale} />
      </div>
      {summary?.parallel ? <p className="px-5 py-1.5 text-[13px] text-muted">{t("parallelHint")}</p> : null}
      <div className="px-5 py-2" aria-busy={loading}>
        {notice ? (
          <p role="status" className="mb-3 rounded-xl bg-warn-bg p-3 text-sm text-warn">
            {notice}
          </p>
        ) : null}
        {shownError ? (
          <div role="alert" className="mb-3 text-sm text-warn">
            <p>{message(shownError)}</p>
            <button
              type="button"
              onClick={() => {
                setPickError(null);
                setRefresh((r) => r + 1);
              }}
              className="mt-2 min-h-11 rounded-full border border-plum px-5 font-medium"
            >
              {tAll("common.retry")}
            </button>
          </div>
        ) : null}
        {loading && !errorKey ? <p className="text-muted">{t("loading")}</p> : null}
        {slots && slots.length > 0 ? (
          <h2 className="pb-2 text-[13px] font-semibold uppercase text-muted">{t("times")}</h2>
        ) : null}
        {slots && slots.length > 0 ? (
          <SlotGrid slots={slots} selected={selected} onSelect={setPicked} timezone={timezone} locale={locale} />
        ) : null}
        {slots && slots.length === 0 ? (
          <div className="flex flex-col items-start gap-3">
            <p className="text-muted">{t("noTimes")}</p>
            {searching ? (
              <p className="text-muted">{t("searching")}</p>
            ) : noNextFor === viewKey ? (
              <p className="text-muted">{t("noNextDay")}</p>
            ) : (
              <button
                type="button"
                onClick={nextDay}
                className="min-h-11 rounded-full border border-plum px-5 font-medium"
              >
                {t("nextDay")}
              </button>
            )}
          </div>
        ) : null}
      </div>
      <BookingFooter
        actionLabel={busy ? t("holding") : (pickLabel ?? t("hold"))}
        disabled={!selected || busy}
        onAction={pick}
      >
        {selected && summary ? (
          <>
            <span className="font-semibold">
              {formatDate(selected.startsAt, timezone, locale, "short")} ·{" "}
              {formatTimeRange(selected.startsAt, selected.endsAt, timezone, locale)}
            </span>
            {summary.lines.map((line, i) => (
              <span key={i} className="text-muted">
                {t("serviceWith", { service: line.serviceName, employee: line.employeeName })} ·{" "}
                {formatPrice(line.priceCents, locale)}
              </span>
            ))}
            <span className="font-semibold">{t("total", { price: formatPrice(summary.totalCents, locale) })}</span>
          </>
        ) : (
          <span className="text-muted">{t("pickTime")}</span>
        )}
      </BookingFooter>
    </div>
  );
}
