"use client";

import type { BookingCatalog } from "@beautyspa/contracts";
import { useEffect, useState } from "react";
import { getBrowserApi } from "@/lib/api/browser";

export type BookingContext = { catalog: BookingCatalog; timezone: string; horizonDays: number };

/** Location timezone and the STAFF booking catalog, loaded once for the booking pages. */
export function useBookingContext(): { context: BookingContext | null; error: unknown; reload: () => void } {
  const [context, setContext] = useState<BookingContext | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const api = getBrowserApi();
    Promise.all([api.public.locations(), api.staff.bookingCatalog()]).then(
      ([locations, catalog]) => {
        if (cancelled) return;
        setError(null);
        setContext({
          catalog,
          timezone: locations[0]?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
          horizonDays: locations[0]?.booking.bookingHorizonDays ?? 30,
        });
      },
      (err: unknown) => !cancelled && setError(err),
    );
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  return { context, error, reload: () => setAttempt((n) => n + 1) };
}
