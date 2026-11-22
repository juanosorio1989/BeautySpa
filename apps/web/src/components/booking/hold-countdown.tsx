"use client";

import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";

const remainingMs = (deadline: number): number => Math.max(0, deadline - Date.now());

function mmss(ms: number): string {
  const total = Math.ceil(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

/**
 * Pass a stable `onExpire` (useCallback). "We're holding your time for m:ss", counted down to the
 * hold's `localExpiresAt` (device clock, never the server's `expiresAt`); calls `onExpire` once at 0.
 */
export function HoldCountdown({ localExpiresAt, onExpire }: { localExpiresAt: number; onExpire: () => void }) {
  const t = useTranslations("booking.details");
  const [left, setLeft] = useState(() => remainingMs(localExpiresAt));
  const fired = useRef(false);

  useEffect(() => {
    const check = (): number => {
      const ms = remainingMs(localExpiresAt);
      if (ms === 0 && !fired.current) {
        fired.current = true;
        onExpire();
      }
      return ms;
    };
    check();
    const timer = setInterval(() => setLeft(check()), 1000);
    return () => clearInterval(timer);
  }, [localExpiresAt, onExpire]);

  return (
    <div className="mx-5 mt-1 flex items-center gap-2.5 rounded-xl bg-warn-bg px-3.5 py-3 text-sm text-warn">
      <svg
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" />
      </svg>
      <span>{t("holding", { time: mmss(left) })}</span>
    </div>
  );
}
