"use client";

import { ApiError } from "@beautyspa/api-client";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import type { ManageView as ManageViewData } from "@beautyspa/contracts";
import type { Locale } from "@beautyspa/i18n";
import { CallSalon } from "@/components/me/call-salon";
import { CancelSheet } from "@/components/me/cancel-sheet";
import { getBrowserApi } from "@/lib/api/browser";
import { formatDate, formatPrice, formatTimeRange } from "@/lib/format";
import { useErrorText } from "@/lib/use-error-text";

type State =
  { kind: "loading" } | { kind: "invalid" } | { kind: "error"; message: string } | { kind: "ok"; view: ManageViewData };

const BUTTON = "flex min-h-[52px] items-center justify-center rounded-[14px] px-4 text-base font-semibold no-underline";

/** What a customer sees from an email or push link: no login, the token is the credential. */
export function ManageView({ token }: { token: string }) {
  const t = useTranslations("manage");
  const tStatus = useTranslations("me.status");
  const locale = useLocale() as Locale;
  const errorText = useErrorText();
  const [state, setState] = useState<State>({ kind: "loading" });
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);

  useEffect(() => {
    let alive = true;
    getBrowserApi()
      .manage.get(token)
      .then((view) => alive && setState({ kind: "ok", view }))
      .catch((err: unknown) => {
        if (!alive) return;
        if (err instanceof ApiError && err.status === 404) setState({ kind: "invalid" });
        else setState({ kind: "error", message: errorText(err) });
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- errorText is recreated each render
  }, [token]);

  if (state.kind === "loading") return <p className="p-5 text-muted">{t("loading")}</p>;
  if (state.kind === "error")
    return (
      <p role="alert" className="p-5 text-warn">
        {state.message}
      </p>
    );
  if (state.kind === "invalid")
    return (
      <main className="flex flex-col items-start gap-4 p-5">
        <h1 className="font-heading text-xl font-semibold">{t("invalid")}</h1>
        <a href={`/${locale}/me`} className="flex min-h-11 items-center font-semibold underline">
          {t("toMyAppointments")}
        </a>
      </main>
    );

  const { view } = state;
  const { appointment, location } = view;
  const tz = location.timezone;
  const booked = appointment.status === "BOOKED";
  const confirmed = appointment.confirmedByCustomerAt !== null;

  async function confirm() {
    setBusy(true);
    setActionError(null);
    try {
      setState({ kind: "ok", view: await getBrowserApi().manage.confirm(token) });
    } catch (err) {
      setActionError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex w-full max-w-[520px] flex-col gap-4 p-5">
      <section className="flex flex-col gap-3 rounded-[18px] border border-line bg-card p-[18px]">
        <span className="font-heading text-xl font-semibold">
          {formatDate(appointment.startsAt, tz, locale, "long")}
        </span>
        <span className="text-[15px]">{formatTimeRange(appointment.startsAt, appointment.endsAt, tz, locale)}</span>
        <span className="text-[15px] font-semibold">
          {t("total", { total: formatPrice(appointment.totalPriceCents, locale) })}
        </span>
        <p className="text-[13px] text-muted">
          {location.name}
          {location.addressLine ? `, ${location.addressLine}` : ""}
        </p>
        {booked ? null : (
          <p className="font-semibold">
            {appointment.status === "CANCELLED" ? t("cancelled") : tStatus(appointment.status)}
          </p>
        )}
        {booked && confirmed ? <p className="font-semibold text-plum">{t("confirmed")}</p> : null}
      </section>
      {actionError ? (
        <p role="alert" className="text-sm text-warn">
          {actionError}
        </p>
      ) : null}
      {view.canConfirm ? (
        <button
          type="button"
          disabled={busy}
          onClick={() => void confirm()}
          className={`${BUTTON} bg-plum text-white hover:bg-plum-hover disabled:cursor-not-allowed disabled:bg-muted`}
        >
          {busy ? t("confirming") : t("confirm")}
        </button>
      ) : null}
      {booked ? (
        <>
          <a href={getBrowserApi().manage.calendarUrl(token)} className={`${BUTTON} border border-plum text-plum`}>
            {t("addToCalendar")}
          </a>
          <a
            href={`/${locale}/login?next=${encodeURIComponent(`/${locale}/me`)}`}
            className={`${BUTTON} border border-plum text-plum`}
          >
            {t("reschedule")}
          </a>
          {view.canCancel ? (
            <button
              type="button"
              onClick={() => setCancelling(true)}
              className={`${BUTTON} border border-plum text-plum`}
            >
              {t("cancel")}
            </button>
          ) : (
            <CallSalon phone={location.phone} />
          )}
        </>
      ) : null}
      {appointment.status === "CANCELLED" ? (
        <a href={`/${locale}/services`} className={`${BUTTON} bg-plum text-white hover:bg-plum-hover hover:text-white`}>
          {t("bookAgain")}
        </a>
      ) : null}
      {cancelling ? (
        <CancelSheet
          appointment={appointment}
          location={{ phone: location.phone }}
          onConfirm={async (body) => {
            const next = await getBrowserApi().manage.cancel(token, body);
            setState({ kind: "ok", view: next });
            return next.appointment;
          }}
          onClose={() => setCancelling(false)}
          onCancelled={() => setCancelling(false)}
        />
      ) : null}
    </main>
  );
}
