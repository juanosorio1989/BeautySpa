"use client";

import { ApiError } from "@beautyspa/api-client";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Me, MePatch } from "@beautyspa/contracts";
import type { Locale } from "@beautyspa/i18n";
import { BackHeader } from "@/components/booking/back-header";
import { DetailsForm, type DetailsValues } from "@/components/booking/details-form";
import { HoldCountdown } from "@/components/booking/hold-countdown";
import { OtpFlow } from "@/components/booking/otp-flow";
import { useRouter } from "@/i18n/navigation";
import { getBrowserApi } from "@/lib/api/browser";
import { bookingStore, useBookingStore } from "@/lib/booking/store";
import { fieldErrors } from "@/lib/errors";
import { useSession } from "@/lib/session/use-session";
import { useErrorText } from "@/lib/use-error-text";

const TIME = "/book/time";
const noop = () => undefined;

export default function DetailsPage() {
  const t = useTranslations("booking.details");
  const tAll = useTranslations();
  const locale = useLocale() as Locale;
  const router = useRouter();
  const store = useBookingStore();
  const session = useSession();
  const errorText = useErrorText();
  const [me, setMe] = useState<Me | null>(null);
  const [meError, setMeError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [fields, setFields] = useState<Record<string, string>>({});
  // Set while the booking finishes or "Not you?" swaps the session, so the store changes don't redirect.
  const quiet = useRef(false);

  const { hold, ready } = store;
  const expire = useCallback(() => router.replace(`${TIME}?notice=expired`), [router]);

  // A stored hold that is already past expiresAt is sent back by HoldCountdown on mount.
  useEffect(() => {
    if (ready && hold === null && !quiet.current) router.replace(TIME);
  }, [ready, hold, router]);

  useEffect(() => {
    if (ready && hold !== null) session.ensure().catch(noop);
    // `ensure` is stable; run once when a hold appears
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, hold === null]);

  useEffect(() => {
    if (session.status !== "signedIn") return;
    let cancelled = false;
    getBrowserApi()
      .me.get()
      .then(
        (m) => !cancelled && setMe(m),
        (err: unknown) => !cancelled && setMeError(errorText(err)),
      );
    return () => {
      cancelled = true;
    };
    // errorText is recreated every render; the request depends on the session and retries only
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.status, attempt]);

  async function notYou() {
    const snapshot = bookingStore.getState();
    quiet.current = true;
    setMe(null);
    setMeError(null);
    try {
      await session.logout().catch(noop);
      // logout() clears the booking store; the customer keeps the held time, only the account changes.
      bookingStore.prefill(snapshot.choices);
      bookingStore.setDate(snapshot.date);
      bookingStore.setSlot(snapshot.slot);
      if (snapshot.hold) bookingStore.setHold(snapshot.hold);
    } finally {
      quiet.current = false;
    }
  }

  async function confirm(v: DetailsValues) {
    if (!me || !hold) return;
    setBusy(true);
    setError(undefined);
    setFields({});
    try {
      const api = getBrowserApi();
      if (me.name === null) {
        const patch: MePatch = { name: v.name };
        if (me.locale !== locale) patch.locale = locale;
        if (v.email && v.email !== me.email) patch.email = v.email;
        if (v.emailConsent) {
          patch.consents = { EMAIL: true };
          patch.consentSource = "BOOKING_FORM";
        }
        setMe(await api.me.patch(patch));
      }
      const appointment = await api.booking.book(
        v.notes ? { holdId: hold.holdId, notes: v.notes } : { holdId: hold.holdId },
      );
      quiet.current = true;
      store.reset();
      router.replace(`/book/done/${appointment.id}`);
    } catch (err) {
      const code = err instanceof ApiError ? err.problem.code : null;
      if (code === "HOLD_EXPIRED") {
        quiet.current = true;
        router.replace(`${TIME}?notice=expired`);
      } else if (code === "CONFLICT") {
        quiet.current = true;
        store.clearHold();
        router.replace(`${TIME}?notice=conflict`);
      } else {
        const byField = fieldErrors(err);
        if (Object.keys(byField).length > 0) setFields(byField);
        else setError(errorText(err));
        setBusy(false);
      }
    }
  }

  let body: React.ReactNode = null;
  if (ready && hold) {
    if (session.status === "loading" || (session.status === "signedIn" && !me && !meError)) {
      body = <p className="px-5 pt-5 text-muted">{tAll("login.checking")}</p>;
    } else if (session.status === "error" || meError) {
      body = (
        <div role="alert" className="px-5 pt-5 text-warn">
          <p>{meError ?? tAll("errors.network")}</p>
          <button
            type="button"
            onClick={() => {
              if (session.status === "error") session.ensure().catch(noop);
              else {
                setMeError(null);
                setAttempt((n) => n + 1);
              }
            }}
            className="mt-3 min-h-11 rounded-full border border-plum px-5 font-medium"
          >
            {tAll("common.retry")}
          </button>
        </div>
      );
    } else if (session.status === "signedOut") {
      body = (
        <div className="px-5 pt-5">
          <OtpFlow onVerified={noop} />
        </div>
      );
    } else if (me) {
      body = (
        <DetailsForm
          me={me}
          busy={busy}
          error={error}
          fieldErrors={fields}
          onSubmit={(v) => void confirm(v)}
          onNotYou={() => void notYou()}
        />
      );
    }
  }

  return (
    <main className="flex min-h-dvh flex-col">
      <BackHeader href={TIME} backLabel={t("back")} title={t("title")} />
      {ready && hold ? <HoldCountdown expiresAt={hold.expiresAt} onExpire={expire} /> : null}
      {body}
    </main>
  );
}
