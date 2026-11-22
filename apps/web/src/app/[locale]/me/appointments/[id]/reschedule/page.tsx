"use client";

import { ApiError } from "@beautyspa/api-client";
import { useLocale, useTranslations } from "next-intl";
import { useParams } from "next/navigation";
import { useState } from "react";
import type {
  Appointment,
  PublicEmployee,
  PublicLocation,
  PublicService,
  ServiceChoice,
  Slot,
} from "@beautyspa/contracts";
import type { Locale } from "@beautyspa/i18n";
import { BackHeader } from "@/components/booking/back-header";
import { TimePicker } from "@/components/booking/time-picker";
import { CallSalon } from "@/components/me/call-salon";
import { LoadError } from "@/components/me/load-error";
import { useRouter } from "@/i18n/navigation";
import { getBrowserApi } from "@/lib/api/browser";
import { canChangeOnline } from "@/lib/me/window";
import { useAuthedLoad } from "@/lib/session/use-authed-load";

interface Loaded {
  appointment: Appointment | null;
  location: PublicLocation | null;
  services: PublicService[];
  employees: PublicEmployee[];
}

/** One choice per service, in segment order, with the appointment's own professional. */
function choicesOf(appointment: Appointment): ServiceChoice[] {
  const out: ServiceChoice[] = [];
  for (const s of appointment.segments)
    if (!out.some((c) => c.serviceId === s.serviceId)) out.push({ serviceId: s.serviceId, employeeId: s.employeeId });
  return out;
}

export default function ReschedulePage() {
  const t = useTranslations("me.reschedule");
  const tMe = useTranslations("me");
  const locale = useLocale() as Locale;
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [nowMs] = useState(() => Date.now());
  const { data, error, failed, retry } = useAuthedLoad(`/${locale}/me/appointments/${id}/reschedule`, async () => {
    const api = getBrowserApi();
    const [mine, locations, services, employees] = await Promise.all([
      api.me.appointments(),
      api.public.locations(),
      api.public.services(),
      api.public.employees(),
    ]);
    const appointment = mine.upcoming.find((a) => a.id === id) ?? null;
    return {
      appointment,
      location: locations.find((l) => l.id === appointment?.locationId) ?? locations[0] ?? null,
      services: services.services,
      employees,
    } satisfies Loaded;
  });

  return (
    <main>
      <BackHeader href="/me" backLabel={t("back")} title={t("title")} />
      {failed ? (
        <div className="px-5">
          <LoadError error={error} onRetry={retry} />
        </div>
      ) : !data ? (
        <p className="px-5 text-muted">{tMe("loading")}</p>
      ) : !data.appointment || !data.location ? (
        <p className="px-5 text-muted">{t("notFound")}</p>
      ) : (
        <Picker
          key={data.appointment.id}
          appointment={data.appointment}
          location={data.location}
          services={data.services}
          employees={data.employees}
          locale={locale}
          nowMs={nowMs}
          onDone={() => router.push("/me")}
        />
      )}
    </main>
  );
}

function Picker({
  appointment,
  location,
  services,
  employees,
  locale,
  nowMs,
  onDone,
}: {
  appointment: Appointment;
  location: PublicLocation;
  services: PublicService[];
  employees: PublicEmployee[];
  locale: Locale;
  nowMs: number;
  onDone: () => void;
}) {
  const t = useTranslations("me.reschedule");
  const [choices, setChoices] = useState(() => choicesOf(appointment));
  const [date, setDate] = useState<string | null>(null);
  const [tooLate, setTooLate] = useState(
    !canChangeOnline(appointment.startsAt, location.booking.cancelWindowHours, nowMs),
  );

  const fixed = choices
    .map((c) => services.find((s) => s.id === c.serviceId))
    .filter((s): s is PublicService => Boolean(s));

  async function reschedule(slot: Slot) {
    try {
      await getBrowserApi().me.reschedule(appointment.id, { segments: slot.segments });
    } catch (err) {
      // SLOT_TAKEN is rethrown: the picker refetches and the old time stays.
      if (err instanceof ApiError && err.problem.code === "OUTSIDE_CANCEL_WINDOW") {
        setTooLate(true);
        return;
      }
      throw err;
    }
    onDone();
  }

  if (tooLate)
    return (
      <div className="mx-auto max-w-[480px] px-5">
        <CallSalon phone={location.phone} />
      </div>
    );

  return (
    <TimePicker
      locale={locale}
      location={location}
      services={fixed}
      employees={employees}
      choices={choices}
      onChoiceChange={(serviceId, employeeId) =>
        setChoices((list) => list.map((c) => (c.serviceId === serviceId ? { ...c, employeeId } : c)))
      }
      date={date}
      onDateChange={setDate}
      excludeAppointmentId={appointment.id}
      onPick={reschedule}
      pickLabel={t("confirm")}
      pickingLabel={t("confirming")}
    />
  );
}
