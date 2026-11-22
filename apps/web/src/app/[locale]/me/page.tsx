"use client";

import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import type { Appointment, MyAppointments, PublicEmployee, PublicLocation, PublicService } from "@beautyspa/contracts";
import type { Locale } from "@beautyspa/i18n";
import { BackHeader } from "@/components/booking/back-header";
import { AppointmentCard } from "@/components/me/appointment-card";
import { CancelSheet } from "@/components/me/cancel-sheet";
import { LoadError } from "@/components/me/load-error";
import { Link, useRouter } from "@/i18n/navigation";
import { getBrowserApi } from "@/lib/api/browser";
import { bookingStore } from "@/lib/booking/store";
import { useAuthedLoad } from "@/lib/session/use-authed-load";
import { useFallbackErrorText } from "@/lib/use-error-text";

interface Loaded {
  appointments: MyAppointments;
  locations: PublicLocation[];
  services: PublicService[];
  employees: PublicEmployee[];
}

async function load(): Promise<Loaded> {
  const api = getBrowserApi();
  const [appointments, locations, services, employees] = await Promise.all([
    api.me.appointments(),
    api.public.locations(),
    api.public.services(),
    api.public.employees(),
  ]);
  return { appointments, locations, services: services.services, employees };
}

export default function MePage() {
  const t = useTranslations("me");
  const locale = useLocale() as Locale;
  const router = useRouter();
  const errorText = useFallbackErrorText();
  const { data, setData, error, failed, retry } = useAuthedLoad(`/${locale}/me`, load);
  const [nowMs] = useState(() => Date.now());
  const [cancelling, setCancelling] = useState<Appointment | null>(null);
  const [repeatingId, setRepeatingId] = useState<string | null>(null);
  const [repeatError, setRepeatError] = useState<string | null>(null);

  async function bookAgain(appointment: Appointment) {
    setRepeatingId(appointment.id);
    setRepeatError(null);
    try {
      const { services } = await getBrowserApi().me.repeat(appointment.id);
      bookingStore.prefill(services);
      router.push(services.length > 0 ? "/book/time" : "/");
    } catch (err) {
      setRepeatError(errorText(err));
      setRepeatingId(null);
    }
  }

  const body = () => {
    if (failed) return <LoadError error={error} onRetry={retry} />;
    if (!data) return <p className="text-muted">{t("loading")}</p>;
    const { appointments, locations, services, employees } = data;
    const locationOf = (a: Appointment) => locations.find((l) => l.id === a.locationId) ?? locations[0];
    const card = (a: Appointment, kind: "upcoming" | "past") => {
      const location = locationOf(a);
      return location ? (
        <li key={a.id}>
          <AppointmentCard
            appointment={a}
            services={services}
            employees={employees}
            location={location}
            locale={locale}
            kind={kind}
            nowMs={nowMs}
            onCancel={setCancelling}
            onBookAgain={(x) => void bookAgain(x)}
            bookingAgain={repeatingId === a.id}
          />
        </li>
      ) : null;
    };
    if (appointments.upcoming.length === 0 && appointments.past.length === 0)
      return (
        <div className="flex flex-col items-start gap-3">
          <p className="text-muted">{t("empty")}</p>
          <Link
            href="/"
            className="flex min-h-[52px] items-center rounded-[14px] bg-plum px-6 font-semibold text-white no-underline hover:bg-plum-hover hover:text-white"
          >
            {t("bookNow")}
          </Link>
        </div>
      );
    return (
      <>
        {repeatError ? (
          <p role="alert" className="text-warn">
            {repeatError}
          </p>
        ) : null}
        {appointments.upcoming.length > 0 ? (
          <section aria-labelledby="upcoming-title" className="flex flex-col gap-3">
            <h2 id="upcoming-title" className="text-[13px] font-semibold uppercase text-muted">
              {t("upcoming")}
            </h2>
            <ul className="flex flex-col gap-5">{appointments.upcoming.map((a) => card(a, "upcoming"))}</ul>
          </section>
        ) : null}
        {appointments.past.length > 0 ? (
          <section aria-labelledby="past-title" className="flex flex-col gap-3">
            <h2 id="past-title" className="text-[13px] font-semibold uppercase text-muted">
              {t("past")}
            </h2>
            <ul className="flex flex-col gap-5">{appointments.past.map((a) => card(a, "past"))}</ul>
          </section>
        ) : null}
        <Link href="/me/profile" className="flex min-h-11 items-center self-start font-medium">
          {t("profileLink")}
        </Link>
        {cancelling && locationOf(cancelling) ? (
          <CancelSheet
            appointment={cancelling}
            location={locationOf(cancelling)!}
            onClose={() => setCancelling(null)}
            onCancelled={(updated) => {
              setData({
                ...data,
                appointments: {
                  upcoming: appointments.upcoming.filter((a) => a.id !== updated.id),
                  past: [updated, ...appointments.past.filter((a) => a.id !== updated.id)],
                },
              });
              setCancelling(null);
            }}
          />
        ) : null}
      </>
    );
  };

  return (
    <main>
      <BackHeader href="/" backLabel={t("back")} title={t("title")} />
      <div className="mx-auto flex max-w-[480px] flex-col gap-5 px-5 pb-10 pt-2">{body()}</div>
    </main>
  );
}
