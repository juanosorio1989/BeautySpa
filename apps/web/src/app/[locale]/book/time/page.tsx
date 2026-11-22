"use client";

import { useTranslations } from "next-intl";
import { useParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import type { PublicEmployee, PublicLocation, PublicService } from "@beautyspa/contracts";
import type { Locale } from "@beautyspa/i18n";
import { BackHeader } from "@/components/booking/back-header";
import { TimeNotice } from "@/components/booking/time-notice";
import { TimePicker } from "@/components/booking/time-picker";
import { useRouter } from "@/i18n/navigation";
import { getBrowserApi } from "@/lib/api/browser";
import { useBookingStore } from "@/lib/booking/store";
import { errorMessageKey } from "@/lib/errors";

interface Catalog {
  location: PublicLocation;
  services: PublicService[];
  employees: PublicEmployee[];
}

export default function TimePage() {
  const t = useTranslations("booking.time");
  const tAll = useTranslations();
  const locale = useParams<{ locale: Locale }>().locale;
  const router = useRouter();
  const store = useBookingStore();
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  const empty = store.ready && store.serviceIds.length === 0;
  useEffect(() => {
    if (empty) router.replace("/");
  }, [empty, router]);

  useEffect(() => {
    if (empty) return;
    let cancelled = false;
    const api = getBrowserApi().public;
    Promise.all([api.locations(), api.services(), api.employees()]).then(
      ([locations, services, employees]) => {
        const location = locations[0];
        if (cancelled) return;
        if (location) setCatalog({ location, services: services.services, employees });
        else setErrorKey("errors.generic");
      },
      (err: unknown) => !cancelled && setErrorKey(errorMessageKey(err)),
    );
    return () => {
      cancelled = true;
    };
  }, [empty, attempt]);

  // Stored services that left the catalog are dropped; only if none remain do we go back to step 1.
  const missing = catalog ? store.serviceIds.filter((id) => !catalog.services.some((s) => s.id === id)) : [];
  useEffect(() => {
    for (const id of missing) store.toggleService(id);
    // `missing` is derived from the two inputs below
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catalog, store.serviceIds]);

  const selected = useMemo(
    () =>
      catalog
        ? store.serviceIds
            .map((id) => catalog.services.find((s) => s.id === id))
            .filter((s): s is PublicService => Boolean(s))
        : [],
    [catalog, store.serviceIds],
  );
  const stale = catalog !== null && selected.length === 0;
  useEffect(() => {
    if (stale) router.replace("/");
  }, [stale, router]);

  return (
    <main>
      <BackHeader href="/" backLabel={t("back")} title={t("title")} />
      <Suspense>
        <TimeNotice />
      </Suspense>
      {errorKey ? (
        <div role="alert" className="px-5 text-warn">
          <p>{tAll.has(errorKey as never) ? tAll(errorKey as never) : tAll("errors.generic")}</p>
          <button
            type="button"
            onClick={() => {
              setErrorKey(null);
              setAttempt((n) => n + 1);
            }}
            className="mt-3 min-h-11 rounded-full border border-plum px-5 font-medium"
          >
            {tAll("common.retry")}
          </button>
        </div>
      ) : null}
      {catalog && selected.length > 0 ? (
        <TimePicker
          locale={locale}
          location={catalog.location}
          services={selected}
          employees={catalog.employees}
          choices={store.choices}
          onChoiceChange={store.setChoice}
          date={store.date}
          onDateChange={store.setDate}
        />
      ) : null}
    </main>
  );
}
