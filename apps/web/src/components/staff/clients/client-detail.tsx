"use client";

import { ApiError } from "@beautyspa/api-client";
import type { StaffAppointment, StaffCustomer, StaffCustomerAppointments } from "@beautyspa/contracts";
import type { Locale } from "@beautyspa/i18n";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { Link } from "@/i18n/navigation";
import { getBrowserApi } from "@/lib/api/browser";
import { formatDate, formatTimeRange } from "@/lib/format";
import { localized } from "@/lib/localized";
import { formatUsPhone } from "@/lib/phone";
import { useBookingContext, type BookingContext } from "@/lib/staff/use-booking-context";
import { useErrorText } from "@/lib/use-error-text";
import { NotesEditor } from "./notes-editor";

const STATUS_STYLE: Record<StaffAppointment["status"], string> = {
  HELD: "bg-chip text-ink",
  BOOKED: "bg-chip text-ink",
  CHECKED_IN: "bg-plum-tint text-plum-hover",
  COMPLETED: "bg-ok-bg text-ok",
  NO_SHOW: "bg-warn-bg text-warn",
  CANCELLED: "bg-chip text-muted line-through",
};
const CHANNELS = ["WHATSAPP", "SMS", "EMAIL", "PUSH"] as const;

type Loaded = { customer: StaffCustomer; appointments: StaffCustomerAppointments | null };

function AppointmentRow({
  a,
  catalog,
  timezone,
  locale,
}: {
  a: StaffAppointment;
  catalog: BookingContext["catalog"] | null;
  timezone: string;
  locale: Locale;
}) {
  const t = useTranslations("staff.clientsPage");
  const services = [...a.segments]
    .sort((x, y) => Date.parse(x.startsAt) - Date.parse(y.startsAt))
    .map((s) => {
      const service = catalog?.services.find((c) => c.id === s.serviceId);
      const who = catalog?.employees.find((e) => e.id === s.employeeId)?.displayName;
      const name = service ? localized(service.name, locale) : t("unknownService");
      return who ? `${name} · ${who}` : name;
    });
  return (
    <li className="flex flex-col gap-0.5 rounded-xl border border-line bg-card px-3.5 py-2.5">
      <span className="flex items-center justify-between gap-2">
        <span className="font-semibold">{formatDate(a.startsAt, timezone, locale, "short")}</span>
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_STYLE[a.status]}`}>
          {t(`status.${a.status}`)}
        </span>
      </span>
      <span className="text-[13px] text-muted">{formatTimeRange(a.startsAt, a.endsAt, timezone, locale)}</span>
      {services.map((s, i) => (
        <span key={i} className="text-sm">
          {s}
        </span>
      ))}
      {a.cancelReason ? (
        <span className="text-[13px] text-muted">{t("cancelReason", { reason: a.cancelReason })}</span>
      ) : null}
    </li>
  );
}

function AppointmentList({
  title,
  empty,
  rows,
  ...rest
}: {
  title: string;
  empty: string;
  rows: StaffAppointment[];
  catalog: BookingContext["catalog"] | null;
  timezone: string;
  locale: Locale;
}) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-[13px] font-semibold uppercase text-muted">{title}</h2>
      {rows.length === 0 ? (
        <p className="text-sm text-muted">{empty}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((a) => (
            <AppointmentRow key={a.id} a={a} {...rest} />
          ))}
        </ul>
      )}
    </section>
  );
}

export function ClientDetail({ customerId }: { customerId: string }) {
  const t = useTranslations("staff.clientsPage");
  const errorText = useErrorText();
  const locale = useLocale() as Locale;
  const { context } = useBookingContext();
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [attemptError, setAttemptError] = useState<unknown>(null);

  useEffect(() => {
    let cancelled = false;
    const api = getBrowserApi();
    api.staff.customer(customerId).then(
      (customer) => {
        if (cancelled) return;
        setLoaded({ customer, appointments: null });
        api.staff.customerAppointments(customerId).then(
          (appointments) => !cancelled && setLoaded({ customer, appointments }),
          (err: unknown) => !cancelled && setAttemptError(err),
        );
      },
      (err: unknown) => !cancelled && setError(err),
    );
    return () => {
      cancelled = true;
    };
  }, [customerId]);

  const back = (
    <Link href="/staff/clients" className="inline-flex min-h-11 items-center text-sm font-semibold text-plum">
      {t("back")}
    </Link>
  );

  if (error) {
    const notFound = error instanceof ApiError && error.status === 404;
    return (
      <div className="mx-auto flex max-w-xl flex-col gap-2 px-5 py-6">
        {back}
        <p role={notFound ? undefined : "alert"} className={notFound ? "" : "text-warn"}>
          {notFound ? t("notFound") : errorText(error)}
        </p>
      </div>
    );
  }
  if (!loaded) return <p className="px-5 py-6 text-sm text-muted">{t("loading")}</p>;

  const c = loaded.customer;
  const timezone = context?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const catalog = context?.catalog ?? null;

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-5 px-5 py-6">
      {back}
      <header className="flex flex-col gap-1">
        <h1 className="font-heading text-xl font-bold">{c.name ?? t("client")}</h1>
        <a href={`tel:${c.phoneE164}`} className="inline-flex min-h-11 items-center font-medium text-plum">
          {formatUsPhone(c.phoneE164)}
        </a>
        <p className="text-sm">{c.email ?? t("noEmail")}</p>
        <p className="text-sm text-muted">
          {t("language")}: <span className="text-ink">{c.locale === "es" ? t("languageEs") : t("languageEn")}</span>
        </p>
        <ul className="flex flex-wrap gap-2 pt-1" aria-label={t("consents")}>
          {CHANNELS.map((ch) => (
            <li
              key={ch}
              className={`rounded-full px-2.5 py-1 text-xs font-semibold ${c.consents[ch] ? "bg-ok-bg text-ok" : "bg-chip text-muted"}`}
            >
              {t(`consent.${ch}`)}: {c.consents[ch] ? t("consentOn") : t("consentOff")}
            </li>
          ))}
        </ul>
        <Link
          href={`/staff/book?customerId=${c.id}`}
          className="mt-2 flex min-h-[52px] items-center justify-center rounded-[14px] bg-plum font-semibold text-white"
        >
          {t("book")}
        </Link>
      </header>
      {attemptError ? (
        <p role="alert" className="text-sm text-warn">
          {errorText(attemptError)}
        </p>
      ) : null}
      {loaded.appointments ? (
        <>
          <AppointmentList
            title={t("upcoming")}
            empty={t("noUpcoming")}
            rows={loaded.appointments.upcoming}
            catalog={catalog}
            timezone={timezone}
            locale={locale}
          />
          <AppointmentList
            title={t("past")}
            empty={t("noPast")}
            rows={loaded.appointments.past}
            catalog={catalog}
            timezone={timezone}
            locale={locale}
          />
        </>
      ) : null}
      <NotesEditor customerId={c.id} timezone={timezone} />
    </div>
  );
}
