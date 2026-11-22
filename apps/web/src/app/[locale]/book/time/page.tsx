"use client";

import { useTranslations } from "next-intl";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { PublicEmployee, PublicLocation, PublicService } from "@beautyspa/contracts";
import type { Locale } from "@beautyspa/i18n";
import { TimePicker } from "@/components/booking/time-picker";
import { Link, useRouter } from "@/i18n/navigation";
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

  const selected = useMemo(
    () =>
      catalog
        ? store.serviceIds
            .map((id) => catalog.services.find((s) => s.id === id))
            .filter((s): s is PublicService => Boolean(s))
        : [],
    [catalog, store.serviceIds],
  );
  // A stored service that no longer exists in the catalog: start over from step 1.
  const stale = catalog !== null && selected.length === 0;
  useEffect(() => {
    if (stale) router.replace("/");
  }, [stale, router]);

  const onChoiceChange = useCallback((id: string, employeeId: string) => store.setChoice(id, employeeId), [store]);

  return (
    <main>
      <header className="flex items-center gap-2 px-3 pb-2 pt-4">
        <Link
          href="/"
          aria-label={t("back")}
          className="flex size-11 items-center justify-center rounded-xl text-ink hover:text-ink"
        >
          <svg
            width="22"
            height="22"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </Link>
        <h1 className="font-heading text-lg font-semibold">{t("title")}</h1>
      </header>
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
          onChoiceChange={onChoiceChange}
          date={store.date}
          onDateChange={store.setDate}
        />
      ) : null}
    </main>
  );
}
