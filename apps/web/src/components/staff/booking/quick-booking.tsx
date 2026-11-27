"use client";

import { ApiError } from "@beautyspa/api-client";
import type { ServiceChoice, Slot } from "@beautyspa/contracts";
import { todayIn, utcToWall } from "@beautyspa/datetime";
import type { Locale } from "@beautyspa/i18n";
import { useLocale, useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { DateStrip } from "@/components/booking/date-strip";
import { Link, useRouter } from "@/i18n/navigation";
import { getBrowserApi } from "@/lib/api/browser";
import { dateStrip } from "@/lib/booking/date-strip";
import { formatTime } from "@/lib/format";
import { localized } from "@/lib/localized";
import { listedOverrideSlots } from "@/lib/staff/override-slots";
import { useBookingContext } from "@/lib/staff/use-booking-context";
import { useErrorText } from "@/lib/use-error-text";
import { ClientPicker, type PickedClient } from "./client-picker";
import { StaffServicePicker } from "./staff-service-picker";
import { StaffSlotList } from "./staff-slot-list";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const WALL_TIME = /^\d{2}:\d{2}$/;

type Result = { key: string; slots?: Slot[]; error?: unknown };

export function QuickBooking() {
  const t = useTranslations("staff.book");
  const tCommon = useTranslations("common");
  const errorText = useErrorText();
  const locale = useLocale() as Locale;
  const router = useRouter();
  const params = useSearchParams();
  const { context, error: contextError, reload } = useBookingContext();

  const dateParam = params.get("date");
  const timeParam = params.get("time");
  const employeeParam = params.get("employeeId");
  const customerParam = params.get("customerId");

  const [client, setClient] = useState<PickedClient | null>(null);
  const [choices, setChoices] = useState<ServiceChoice[]>([]);
  const [chosenDate, setChosenDate] = useState<string | null>(dateParam && ISO_DATE.test(dateParam) ? dateParam : null);
  const [other, setOther] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [picked, setPicked] = useState<Slot | null>(null);
  const [confirmed, setConfirmed] = useState<Slot | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const prefill = useRef(timeParam && WALL_TIME.test(timeParam) ? timeParam : null);

  const timezone = context?.timezone ?? null;
  const [now] = useState(() => Date.now());
  const today = timezone ? todayIn(timezone, now) : null;
  const date = chosenDate ?? today;
  const strip = useMemo(() => (today && context ? dateStrip(today, context.horizonDays) : []), [today, context]);

  // ?customerId=: preselect, with the last visit when the search finds the same client by phone.
  useEffect(() => {
    if (!customerParam) return;
    let cancelled = false;
    const api = getBrowserApi().staff;
    api.customer(customerParam).then(
      async (c) => {
        const match = await api.searchCustomers(c.phoneE164).then(
          (rows) => rows.find((r) => r.id === c.id),
          () => undefined,
        );
        if (!cancelled) setClient(match ?? { ...c, lastVisit: null });
      },
      () => undefined, // the picker stays available
    );
    return () => {
      cancelled = true;
    };
  }, [customerParam]);

  function setServices(ids: string[]) {
    setPicked(null);
    setConfirmed(null);
    const forced = employeeParam && prefill.current ? employeeParam : null;
    setChoices(
      ids.map((serviceId) => {
        const existing = choices.find((c) => c.serviceId === serviceId);
        if (existing) return existing;
        const canDo = forced
          ? context?.catalog.employees.some((e) => e.id === forced && e.serviceIds.includes(serviceId))
          : false;
        return { serviceId, employeeId: canDo && forced ? forced : "ANY" };
      }),
    );
  }

  function setEmployee(serviceId: string, employeeId: string) {
    prefill.current = null;
    setPicked(null);
    setConfirmed(null);
    setChoices((list) => list.map((c) => (c.serviceId === serviceId ? { ...c, employeeId } : c)));
  }

  const key = `${date}|${refresh}|${other}|${JSON.stringify(choices)}`;
  useEffect(() => {
    if (!date || choices.length === 0) return;
    let cancelled = false;
    getBrowserApi()
      .staff.availability({ services: choices, date, override: other })
      .then(
        (slots) => !cancelled && setResult({ key, slots }),
        (err: unknown) => !cancelled && setResult({ key, error: err }),
      );
    return () => {
      cancelled = true;
    };
    // `key` encodes date, choices, mode and refresh
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const ready = choices.length > 0 && result?.key === key;
  const slots = useMemo(() => {
    if (!ready || !result?.slots) return undefined;
    return other && timezone ? listedOverrideSlots(result.slots, timezone) : result.slots;
  }, [ready, result, other, timezone]);
  const loadError = ready ? result?.error : undefined;

  // Agenda gap prefill: select the slot that starts at ?time= once, when the first times arrive.
  const [prefilled, setPrefilled] = useState<Slot | null>(null);
  useEffect(() => {
    const time = prefill.current;
    if (!time || !slots || !timezone) return;
    prefill.current = null;
    const match = slots.find(
      (s) =>
        utcToWall(Date.parse(s.startsAt), timezone).time === time &&
        (!employeeParam || s.segments.some((seg) => seg.employeeId === employeeParam)),
    );
    if (match) setPrefilled(match);
  }, [slots, timezone, employeeParam]);

  const selected =
    picked && slots?.includes(picked) ? picked : prefilled && slots?.includes(prefilled) ? prefilled : null;
  const outside = selected?.outsideHours === true;
  const outsideOk = !outside || confirmed === selected;

  function choose(slot: Slot) {
    setPrefilled(null);
    setPicked(slot);
    setConfirmed(null);
  }

  async function save() {
    if (!client || !selected || !outsideOk || !date) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const created = await getBrowserApi().staff.createAppointment({
        customerId: client.id,
        segments: selected.segments,
        override: outside,
        notes: null,
      });
      router.push(`/staff?date=${date}&highlight=${created.id}`);
    } catch (err) {
      if (err instanceof ApiError && err.problem.code === "SLOT_TAKEN") {
        setNotice(errorText(err));
        setPicked(null);
        setPrefilled(null);
        setConfirmed(null);
        setRefresh((n) => n + 1);
      } else {
        setError(errorText(err));
      }
      setBusy(false);
    }
  }

  if (contextError) {
    return (
      <div role="alert" className="py-4 text-sm text-warn">
        <p>{errorText(contextError)}</p>
        <button
          type="button"
          onClick={reload}
          className="mt-2 min-h-11 rounded-full border border-plum px-5 font-medium"
        >
          {tCommon("retry")}
        </button>
      </div>
    );
  }
  if (!context || !timezone || !date) return <p className="py-4 text-muted">{t("loadingTimes")}</p>;

  const names = new Map(context.catalog.employees.map((e) => [e.id, e.displayName]));
  const reachable = client?.email && client.consents.EMAIL;
  const saveLabel = !client
    ? t("pickClient")
    : choices.length === 0
      ? t("pickServices")
      : !selected
        ? t("pickTime")
        : busy
          ? t("saving")
          : t("save", { time: formatTime(selected.startsAt, timezone, locale) });

  return (
    <div className="flex min-h-[calc(100dvh-8rem)] flex-col">
      <header className="flex items-center gap-2 pb-2 pt-2">
        <Link
          href={`/staff?date=${date}`}
          aria-label={t("close")}
          className="flex size-11 items-center justify-center rounded-xl text-ink"
        >
          <svg
            width="22"
            height="22"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </Link>
        <h1 className="font-heading text-lg font-semibold">{t("title")}</h1>
      </header>
      <div className="flex flex-1 flex-col gap-4 pb-4">
        <ClientPicker value={client} onChange={setClient} services={context.catalog.services} />
        <StaffServicePicker
          catalog={context.catalog}
          selected={choices.map((c) => c.serviceId)}
          lastServiceIds={client?.lastVisit?.serviceIds}
          locale={locale}
          onChange={setServices}
        />
        {choices.length > 0 ? (
          <section className="flex flex-col gap-2">
            {choices.map((c) => {
              const service = context.catalog.services.find((s) => s.id === c.serviceId);
              const options = context.catalog.employees.filter((e) => e.serviceIds.includes(c.serviceId));
              if (!service || options.length < 2) return null;
              return (
                <div
                  key={c.serviceId}
                  role="group"
                  aria-label={t("professional", { service: localized(service.name, locale) })}
                  className="flex flex-wrap gap-2"
                >
                  {[{ id: "ANY", displayName: t("anyProfessional") }, ...options].map((o) => (
                    <button
                      key={o.id}
                      type="button"
                      aria-pressed={o.id === c.employeeId}
                      onClick={() => setEmployee(c.serviceId, o.id)}
                      className={`min-h-11 rounded-full px-3.5 text-sm ${
                        o.id === c.employeeId
                          ? "bg-ink font-semibold text-white"
                          : "border border-line-strong bg-card font-medium text-ink"
                      }`}
                    >
                      {o.displayName}
                    </button>
                  ))}
                </div>
              );
            })}
            <DateStrip
              dates={strip}
              selected={date}
              onSelect={(d) => {
                setPicked(null);
                setPrefilled(null);
                setConfirmed(null);
                setChosenDate(d);
              }}
              locale={locale}
            />
            <span className="text-[13px] font-semibold uppercase text-muted">
              {other ? t("timesOther") : t("times", { who: t("anyProfessional") })}
            </span>
            <div aria-busy={!ready} className="flex flex-col gap-2">
              {notice ? (
                <p role="status" className="rounded-xl bg-warn-bg p-3 text-sm text-warn">
                  {notice}
                </p>
              ) : null}
              {!ready ? <p className="text-muted">{t("loadingTimes")}</p> : null}
              {loadError ? (
                <p role="alert" className="text-sm text-warn">
                  {errorText(loadError)}
                </p>
              ) : null}
              {slots && slots.length === 0 ? <p className="text-muted">{t("noTimes")}</p> : null}
              {slots ? (
                <StaffSlotList
                  slots={slots}
                  selected={selected}
                  onSelect={choose}
                  timezone={timezone}
                  locale={locale}
                  employeeNames={names}
                  other={other}
                  onOther={(value) => {
                    setPicked(null);
                    setPrefilled(null);
                    setConfirmed(null);
                    setOther(value);
                  }}
                />
              ) : null}
              {outside && selected ? (
                <div role="status" className="flex flex-col gap-2 rounded-xl bg-warn-bg p-3 text-sm text-warn">
                  <p>{t("outsideHours")}</p>
                  {confirmed === selected ? null : (
                    <button
                      type="button"
                      onClick={() => setConfirmed(selected)}
                      className="min-h-11 rounded-xl border border-warn px-4 font-semibold"
                    >
                      {t("bookAnyway")}
                    </button>
                  )}
                </div>
              ) : null}
            </div>
          </section>
        ) : null}
        {error ? (
          <p role="alert" className="rounded-xl bg-warn-bg p-3 text-sm text-warn">
            {error}
          </p>
        ) : null}
      </div>
      <footer className="-mx-5 flex flex-col gap-2.5 border-t border-line bg-card px-5 pb-6 pt-3.5">
        {client ? <span className="text-sm text-ink">{reachable ? t("confirmByEmail") : t("noMessages")}</span> : null}
        <button
          type="button"
          disabled={!client || !selected || !outsideOk || busy}
          onClick={() => void save()}
          className="min-h-[52px] rounded-[14px] bg-plum text-base font-semibold text-white hover:bg-plum-hover disabled:cursor-not-allowed disabled:bg-muted"
        >
          {saveLabel}
        </button>
      </footer>
    </div>
  );
}
