"use client";

import { ApiError } from "@beautyspa/api-client";
import { useLocale, useTranslations } from "next-intl";
import { useParams, useRouter as useAppRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { Appointment, Me, PublicEmployee, PublicLocation, PublicService } from "@beautyspa/contracts";
import type { Locale } from "@beautyspa/i18n";
import { AppointmentSummary } from "@/components/booking/appointment-summary";
import { EmailOffer } from "@/components/booking/email-offer";
import { Link } from "@/i18n/navigation";
import { getBrowserApi } from "@/lib/api/browser";
import { useSession } from "@/lib/session/use-session";
import { useErrorText } from "@/lib/use-error-text";

interface Loaded {
  me: Me;
  appointment: Appointment;
  location: PublicLocation;
  services: PublicService[];
  employees: PublicEmployee[];
}

const linkButton = "flex items-center justify-center rounded-[14px] font-semibold no-underline";

export default function DonePage() {
  const t = useTranslations("booking.done");
  const tAll = useTranslations();
  const locale = useLocale() as Locale;
  const { appointmentId } = useParams<{ appointmentId: string }>();
  const appRouter = useAppRouter();
  const session = useSession();
  const errorText = useErrorText();
  const [data, setData] = useState<Loaded | null>(null);
  const [failure, setFailure] = useState<{ error: unknown } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [offerDone, setOfferDone] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const signedIn = await session.ensure();
      if (cancelled) return;
      if (!signedIn) {
        const here = `/${locale}/book/done/${appointmentId}`;
        appRouter.replace(`/${locale}/login?next=${encodeURIComponent(here)}`);
        return;
      }
      const api = getBrowserApi();
      const [me, mine, locations, services, employees] = await Promise.all([
        api.me.get(),
        api.me.appointments(),
        api.public.locations(),
        api.public.services(),
        api.public.employees(),
      ]);
      if (cancelled) return;
      const appointment = [...mine.upcoming, ...mine.past].find((a) => a.id === appointmentId);
      const location = locations.find((l) => l.id === appointment?.locationId);
      if (!appointment)
        setFailure({
          error: new ApiError(404, { type: "about:blank", title: "Not found", status: 404, code: "NOT_FOUND" }),
        });
      else if (!location) setFailure({ error: new Error("no location") });
      else setData({ me, appointment, location, services: services.services, employees });
    })().catch((err: unknown) => {
      if (!cancelled) setFailure({ error: err });
    });
    return () => {
      cancelled = true;
    };
    // `session.ensure` is stable; translations are static for the page lifetime
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt, appointmentId, locale]);

  if (failure) {
    return (
      <main className="px-5 pt-12">
        <div role="alert" className="text-warn">
          <p>{errorText(failure.error)}</p>
          <button
            type="button"
            onClick={() => {
              setFailure(null);
              setAttempt((n) => n + 1);
            }}
            className="mt-3 min-h-11 rounded-full border border-plum px-5 font-medium"
          >
            {tAll("common.retry")}
          </button>
        </div>
      </main>
    );
  }
  if (!data) return <main className="px-5 pt-12 text-muted">{t("loading")}</main>;

  const { me, appointment, location, services, employees } = data;
  return (
    <main className="flex min-h-dvh flex-col gap-5 px-5 pb-7 pt-10">
      <div className="flex flex-col items-center gap-3 text-center">
        <div className="flex size-16 items-center justify-center rounded-full bg-ok-bg text-ok">
          <svg
            width="32"
            height="32"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M5 12.5l4.5 4.5L19 7.5" />
          </svg>
        </div>
        <h1 className="font-heading text-[28px] font-semibold">
          {me.name ? t("title", { name: me.name }) : t("titleNoName")}
        </h1>
        <p className="text-[15px] text-muted">{t("subtitle")}</p>
      </div>
      <AppointmentSummary
        appointment={appointment}
        services={services}
        employees={employees}
        location={location}
        locale={locale}
      />
      {!me.consents.EMAIL && !offerDone ? <EmailOffer email={me.email} onSaved={() => setOfferDone(true)} /> : null}
      <div className="mt-2 flex flex-col gap-2.5">
        <Link
          href="/me"
          className={`${linkButton} min-h-[52px] bg-plum text-base text-white hover:bg-plum-hover hover:text-white`}
        >
          {t("myAppointments")}
        </Link>
        <Link href="/" className={`${linkButton} min-h-11 text-[15px]`}>
          {t("bookAnother")}
        </Link>
      </div>
    </main>
  );
}
