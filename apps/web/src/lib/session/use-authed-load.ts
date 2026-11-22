"use client";

import { useLocale } from "next-intl";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { useSession } from "./use-session";

/**
 * Waits for the session, sends signed-out visitors to `/<locale>/login?next=<nextPath>`, then runs `load`.
 * `nextPath` includes the locale. A session `error` or a failed `load` is returned in `error`; `retry` runs it again.
 */
export function useAuthedLoad<T>(nextPath: string, load: () => Promise<T>) {
  const locale = useLocale();
  const router = useRouter();
  const session = useSession();
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<{ cause: unknown } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const loadRef = useRef(load);
  useEffect(() => {
    loadRef.current = load;
  });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!(await session.ensure())) {
        if (!cancelled) router.replace(`/${locale}/login?next=${encodeURIComponent(nextPath)}`);
        return;
      }
      const loaded = await loadRef.current();
      if (!cancelled) setData(loaded);
    })().catch((cause: unknown) => {
      if (!cancelled) setError({ cause });
    });
    return () => {
      cancelled = true;
    };
    // `session.ensure` and `router` are stable for the page lifetime
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt, nextPath, locale]);

  const retry = useCallback(() => {
    setError(null);
    setAttempt((n) => n + 1);
  }, []);

  return { data, setData, error: error ? error.cause : null, failed: error !== null, retry };
}
