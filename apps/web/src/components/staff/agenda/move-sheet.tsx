"use client";

import { ApiError } from "@beautyspa/api-client";
import type { Agenda, ServiceChoice, Slot, StaffAppointment } from "@beautyspa/contracts";
import type { BookingCatalog } from "@beautyspa/contracts";
import { addDays, utcToWall } from "@beautyspa/datetime";
import type { Locale } from "@beautyspa/i18n";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";
import { getBrowserApi } from "@/lib/api/browser";
import { formatTime } from "@/lib/format";
import { localized } from "@/lib/localized";
import { useErrorText } from "@/lib/use-error-text";
import { DateStrip } from "@/components/booking/date-strip";
import { SlotGrid } from "@/components/booking/slot-grid";
import { Sheet } from "./sheet";

const STRIP_DAYS = 30;

type Result = { key: string; slots?: Slot[]; error?: unknown };

export function MoveSheet({
  appointment,
  agenda,
  today,
  locale,
  onClose,
  onChanged,
}: {
  appointment: StaffAppointment;
  agenda: Agenda;
  /** Today's date in the agenda timezone. */
  today: string;
  locale: Locale;
  onClose: () => void;
  onChanged: () => Promise<void> | void;
}) {
  const t = useTranslations("staff.agenda");
  const errorText = useErrorText();
  const a = appointment;
  const segments = useMemo(
    () => [...a.segments].sort((x, y) => Date.parse(x.startsAt) - Date.parse(y.startsAt)),
    [a.segments],
  );
  const [date, setDate] = useState(() => utcToWall(Date.parse(a.startsAt), agenda.timezone).date);
  const [choices, setChoices] = useState<ServiceChoice[]>(() =>
    segments.map((s) => ({ serviceId: s.serviceId, employeeId: s.employeeId })),
  );
  const [catalog, setCatalog] = useState<BookingCatalog["employees"] | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [picked, setPicked] = useState<Slot | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const key = `${date}|${refresh}|${JSON.stringify(choices)}`;
  const strip = useMemo(() => Array.from({ length: STRIP_DAYS }, (_, i) => addDays(today, i)), [today]);

  useEffect(() => {
    getBrowserApi()
      .staff.bookingCatalog({ locationId: agenda.locationId })
      .then((c) => setCatalog(c.employees))
      .catch(() => undefined); // without the catalog each service keeps its current professional
  }, [agenda.locationId]);

  useEffect(() => {
    let cancelled = false;
    getBrowserApi()
      .staff.availability({ services: choices, date, locationId: agenda.locationId, excludeAppointmentId: a.id })
      .then(
        (slots) => !cancelled && setResult({ key, slots }),
        (err: unknown) => !cancelled && setResult({ key, error: err }),
      );
    return () => {
      cancelled = true;
    };
    // `key` encodes date, choices and refresh
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const loading = result?.key !== key;
  // A checked-in appointment keeps its start: nothing earlier is offered (the API enforces it).
  const slots = loading
    ? undefined
    : result?.slots?.filter((s) => a.status !== "CHECKED_IN" || Date.parse(s.startsAt) >= Date.parse(a.startsAt));
  const selected = picked && slots?.includes(picked) ? picked : null;
  const loadError = !loading ? result?.error : undefined;

  function optionsFor(serviceId: string, current: string) {
    const fromCatalog = (catalog ?? []).filter((e) => e.serviceIds.includes(serviceId));
    const list = fromCatalog.length ? fromCatalog : agenda.employees.filter((e) => e.id === current);
    return list.map((e) => ({ id: e.id, label: e.displayName }));
  }

  async function save() {
    if (!selected) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await getBrowserApi().staff.moveAppointment(a.id, { segments: selected.segments });
      await onChanged();
      onClose();
    } catch (err) {
      if (err instanceof ApiError && err.problem.code === "SLOT_TAKEN") {
        setNotice(t("moveSlotTaken"));
        setPicked(null);
        setRefresh((r) => r + 1);
      } else if (err instanceof ApiError && err.problem.code === "CONFLICT") {
        setError(t("changed"));
        await onChanged();
      } else {
        setError(errorText(err));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet titleId="move-title" onClose={onClose}>
      <h2 id="move-title" className="font-heading text-xl font-semibold">
        {t("moveTitle")}
      </h2>
      <div className="flex flex-col gap-3">
        {segments.map((seg, i) => {
          const service = agenda.services.find((s) => s.id === seg.serviceId);
          const name = service ? localized(service.name, locale) : "";
          const current = choices[i]?.employeeId ?? seg.employeeId;
          return (
            <section key={seg.id} role="group" aria-label={name} className="flex flex-col gap-2">
              <div className="text-[13px] font-semibold uppercase text-muted">{name}</div>
              <div className="flex flex-wrap gap-2">
                {[{ id: "ANY", label: t("any") }, ...optionsFor(seg.serviceId, seg.employeeId)].map((o) => (
                  <button
                    key={o.id}
                    type="button"
                    aria-pressed={o.id === current}
                    onClick={() => {
                      setPicked(null);
                      setChoices((list) => list.map((c, j) => (j === i ? { ...c, employeeId: o.id } : c)));
                    }}
                    className={`min-h-11 rounded-full px-3.5 text-sm ${
                      o.id === current
                        ? "bg-ink font-semibold text-white"
                        : "border border-line-strong bg-card font-medium text-ink"
                    }`}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            </section>
          );
        })}
      </div>
      <DateStrip
        dates={strip}
        selected={date}
        onSelect={(d) => {
          setPicked(null);
          setDate(d);
        }}
        locale={locale}
      />
      <div aria-busy={loading} className="flex flex-col gap-3">
        {notice ? (
          <p role="status" className="rounded-xl bg-warn-bg p-3 text-sm text-warn">
            {notice}
          </p>
        ) : null}
        {loading ? <p className="text-muted">{t("moveLoading")}</p> : null}
        {loadError ? (
          <p role="alert" className="text-sm text-warn">
            {errorText(loadError)}
          </p>
        ) : null}
        {slots && slots.length === 0 ? <p className="text-muted">{t("moveNoTimes")}</p> : null}
        {slots && slots.length > 0 ? (
          <SlotGrid slots={slots} selected={selected} onSelect={setPicked} timezone={agenda.timezone} locale={locale} />
        ) : null}
      </div>
      {error ? (
        <p role="alert" className="rounded-xl bg-warn-bg p-3 text-sm text-warn">
          {error}
        </p>
      ) : null}
      <button
        type="button"
        disabled={!selected || busy}
        onClick={() => void save()}
        className="min-h-[52px] rounded-[14px] bg-plum text-base font-semibold text-white hover:bg-plum-hover disabled:cursor-not-allowed disabled:bg-muted"
      >
        {busy
          ? t("moveSaving")
          : selected
            ? t("moveSave", { time: formatTime(selected.startsAt, agenda.timezone, locale) })
            : t("movePick")}
      </button>
      <button type="button" onClick={onClose} className="min-h-11 rounded-[14px] text-[15px] font-semibold">
        {t("close")}
      </button>
    </Sheet>
  );
}
