"use client";

import type { StaffCustomerSearchResult } from "@beautyspa/contracts";
import { useEffect, useState } from "react";
import { getBrowserApi } from "@/lib/api/browser";

export const SEARCH_DEBOUNCE_MS = 300;
export const SEARCH_MIN_CHARS = 2;

type Result = { q: string; rows?: StaffCustomerSearchResult[]; error?: unknown };

/** Debounced client search (>= 2 characters), shared by the quick booking picker and the clients page. */
export function useCustomerSearch(input: string): {
  results: StaffCustomerSearchResult[];
  loading: boolean;
  error: unknown;
  active: boolean;
} {
  const q = input.trim();
  const active = q.length >= SEARCH_MIN_CHARS;
  const [result, setResult] = useState<Result | null>(null);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      getBrowserApi()
        .staff.searchCustomers(q)
        .then(
          (rows) => !cancelled && setResult({ q, rows }),
          (error: unknown) => !cancelled && setResult({ q, error }),
        );
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [q, active]);

  const current = active && result?.q === q ? result : null;
  return { results: current?.rows ?? [], loading: active && !current, error: current?.error ?? null, active };
}
