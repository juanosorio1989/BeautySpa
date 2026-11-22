"use client";

import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Suspense, useEffect, useRef, useState } from "react";
import type { PublicService, PublicServicesResponse } from "@beautyspa/contracts";
import type { Locale } from "@beautyspa/i18n";
import { useRouter } from "@/i18n/navigation";
import { useBookingStore } from "@/lib/booking/store";
import { formatPrice } from "@/lib/format";
import { localized } from "@/lib/localized";
import { BookingFooter } from "./booking-footer";

const OTHER = "other";

/** Duration hint: parallel services overlap, so they count as the longest one. */
function durationHint(selected: PublicService[]): number {
  const serial = selected.filter((s) => !s.parallelizable).reduce((sum, s) => sum + s.durationMin, 0);
  const parallel = Math.max(0, ...selected.filter((s) => s.parallelizable).map((s) => s.durationMin));
  return serial + parallel;
}

/**
 * Reads `?service=<id>` in its own Suspense boundary so the rest of the page can render on the server.
 * Adds the service once the store is ready and reports the outcome to the picker.
 */
function PreselectFromUrl({
  services,
  onResult,
}: {
  services: PublicService[];
  onResult: (service: PublicService, result: "ok" | "limit") => void;
}) {
  const preselect = useSearchParams().get("service");
  const { ready, serviceIds, toggleService } = useBookingStore();
  const handled = useRef(false);

  useEffect(() => {
    if (!ready || !preselect || handled.current) return;
    const service = services.find((s) => s.id === preselect);
    if (!service) return;
    handled.current = true;
    const catalogIds = services.map((s) => s.id);
    onResult(service, serviceIds.includes(service.id) ? "ok" : toggleService(service.id, catalogIds));
    // run once per page load, when the store becomes ready
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, preselect]);

  return null;
}

export function ServicePicker({ data, locale }: { data: PublicServicesResponse; locale: Locale }) {
  const t = useTranslations("booking.services");
  const ts = useTranslations("services");
  const router = useRouter();
  const store = useBookingStore();
  const [chosenCategory, setChosenCategory] = useState<string | null>(null);
  const [limit, setLimit] = useState(false);

  const known = new Set(data.categories.map((c) => c.id));
  const catalogIds = data.services.map((s) => s.id);
  const categoryOf = (s: PublicService) => (s.categoryId && known.has(s.categoryId) ? s.categoryId : OTHER);
  const chips = [
    ...[...data.categories]
      .sort((a, b) => a.sort - b.sort)
      .map((c) => ({ id: c.id, label: localized(c.name, locale) })),
    { id: OTHER, label: t("other") },
  ].filter((chip) => data.services.some((s) => categoryOf(s) === chip.id));
  const active = chosenCategory ?? chips[0]?.id;

  const selected = store.serviceIds
    .map((id) => data.services.find((s) => s.id === id))
    .filter((s): s is PublicService => Boolean(s));
  const fromTotal = selected.reduce((sum, s) => sum + s.fromPriceCents, 0);
  const hasRange = selected.some((s) => s.fromPriceCents !== s.priceCents);

  if (data.services.length === 0) return <p className="px-5 text-muted">{t("empty")}</p>;

  return (
    <div className="mx-auto max-w-[480px]">
      <Suspense>
        <PreselectFromUrl
          services={data.services}
          onResult={(service, result) => {
            setChosenCategory(categoryOf(service));
            setLimit(result === "limit");
          }}
        />
      </Suspense>
      <nav aria-label={t("categories")} className="flex gap-2 overflow-x-auto px-5 pb-4">
        {chips.map((chip) => (
          <button
            key={chip.id}
            type="button"
            aria-pressed={chip.id === active}
            onClick={() => setChosenCategory(chip.id)}
            className={`min-h-11 shrink-0 rounded-full px-4 text-sm font-semibold ${
              chip.id === active ? "bg-plum text-white" : "border border-line-strong bg-card font-medium text-ink"
            }`}
          >
            {chip.label}
          </button>
        ))}
      </nav>
      <div className="flex flex-col gap-2.5 px-5">
        {data.services
          .filter((s) => categoryOf(s) === active)
          .map((s) => {
            const on = store.serviceIds.includes(s.id);
            return (
              <label
                key={s.id}
                className={`flex items-center gap-3.5 rounded-2xl bg-card p-4 ${
                  on ? "border-2 border-plum p-[15px]" : "border border-line"
                }`}
              >
                <input
                  type="checkbox"
                  checked={on}
                  onChange={() => setLimit(store.toggleService(s.id, catalogIds) === "limit")}
                  className="size-[22px] accent-plum"
                />
                <span className="flex flex-1 flex-col gap-0.5">
                  <span className="text-base font-semibold">{localized(s.name, locale)}</span>
                  <span className="text-[13px] text-muted">
                    {ts("minutes", { count: s.durationMin })}
                    {s.parallelizable ? ` · ${ts("parallel")}` : ""}
                  </span>
                </span>
                <span className="text-base font-semibold">
                  {s.fromPriceCents !== s.priceCents
                    ? ts("from", { price: formatPrice(s.fromPriceCents, locale) })
                    : formatPrice(s.priceCents, locale)}
                </span>
              </label>
            );
          })}
      </div>
      <p role="status" className="px-5 pt-3 text-sm text-warn">
        {limit ? t("limit") : ""}
      </p>
      <BookingFooter
        actionLabel={t("continue")}
        disabled={selected.length === 0}
        onAction={() => router.push("/book/time")}
      >
        <div className="flex justify-between">
          <span>{t("summary", { count: selected.length, minutes: durationHint(selected) })}</span>
          <span className="font-semibold">
            {hasRange ? ts("from", { price: formatPrice(fromTotal, locale) }) : formatPrice(fromTotal, locale)}
          </span>
        </div>
      </BookingFooter>
    </div>
  );
}
