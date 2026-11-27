"use client";

import { ApiError } from "@beautyspa/api-client";
import type { ServiceChoice, StaffAppointment } from "@beautyspa/contracts";
import { utcToWall } from "@beautyspa/datetime";
import type { Locale } from "@beautyspa/i18n";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { Link } from "@/i18n/navigation";
import { getBrowserApi } from "@/lib/api/browser";
import { formatTime } from "@/lib/format";
import { useBookingContext } from "@/lib/staff/use-booking-context";
import { useErrorText } from "@/lib/use-error-text";
import { ClientPicker, type PickedClient } from "./client-picker";
import { StaffServicePicker } from "./staff-service-picker";

export function WalkIn() {
  const t = useTranslations("staff.walkIn");
  const tBook = useTranslations("staff.book");
  const tCommon = useTranslations("common");
  const errorText = useErrorText();
  const locale = useLocale() as Locale;
  const { context, error: contextError, reload } = useBookingContext();
  const [client, setClient] = useState<PickedClient | null>(null);
  const [serviceIds, setServiceIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [noOneFree, setNoOneFree] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [started, setStarted] = useState<StaffAppointment | null>(null);

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
  if (!context) return <p className="py-4 text-muted">{tBook("loadingTimes")}</p>;

  async function start() {
    setBusy(true);
    setError(null);
    setNoOneFree(false);
    const services: ServiceChoice[] = serviceIds.map((serviceId) => ({ serviceId, employeeId: "ANY" }));
    try {
      setStarted(await getBrowserApi().staff.walkIn({ customerId: client?.id ?? null, services }));
    } catch (err) {
      if (err instanceof ApiError && err.problem.code === "SLOT_TAKEN") setNoOneFree(true);
      else setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  if (started && context) {
    const first = started.segments[0];
    const employee = context.catalog.employees.find((e) => e.id === first?.employeeId)?.displayName ?? "";
    const date = utcToWall(Date.parse(started.startsAt), context.timezone).date;
    return (
      <div role="status" className="flex flex-col gap-3 py-6">
        <h1 className="font-heading text-xl font-semibold">{t("started")}</h1>
        <p className="text-[15px]">
          {t("startedWith", { employee, time: formatTime(started.startsAt, context.timezone, locale) })}
        </p>
        <Link
          href={`/staff?date=${date}&highlight=${started.id}`}
          className="flex min-h-[52px] items-center justify-center rounded-[14px] bg-plum font-semibold text-white hover:text-white"
        >
          {t("backToAgenda")}
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 pb-6 pt-2">
      <h1 className="font-heading text-lg font-semibold">{t("title")}</h1>
      <ClientPicker value={client} onChange={setClient} allowSkip services={context.catalog.services} />
      <StaffServicePicker
        catalog={context.catalog}
        selected={serviceIds}
        lastServiceIds={client?.lastVisit?.serviceIds}
        locale={locale}
        onChange={setServiceIds}
      />
      {noOneFree ? (
        <div role="alert" className="flex flex-col gap-2 rounded-xl bg-warn-bg p-3 text-sm text-warn">
          <p>{t("noOneFree")}</p>
          <Link href="/staff/book" className="min-h-11 font-semibold">
            {t("bookLater")}
          </Link>
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="rounded-xl bg-warn-bg p-3 text-sm text-warn">
          {error}
        </p>
      ) : null}
      <button
        type="button"
        disabled={serviceIds.length === 0 || busy}
        onClick={() => void start()}
        className="min-h-[52px] rounded-[14px] bg-plum text-base font-semibold text-white hover:bg-plum-hover disabled:cursor-not-allowed disabled:bg-muted"
      >
        {busy ? t("starting") : serviceIds.length === 0 ? t("pickServices") : t("start")}
      </button>
    </div>
  );
}
