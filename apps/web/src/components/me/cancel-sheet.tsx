"use client";

import { ApiError } from "@beautyspa/api-client";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import type { Appointment, PublicLocation } from "@beautyspa/contracts";
import { getBrowserApi } from "@/lib/api/browser";
import { useFallbackErrorText } from "@/lib/use-error-text";
import { CallSalon } from "./call-salon";

interface Props {
  appointment: Appointment;
  location: PublicLocation;
  onClose: () => void;
  onCancelled: (updated: Appointment) => void;
}

/** Confirmation sheet with an optional reason. The API decides the window (409 OUTSIDE_CANCEL_WINDOW). */
export function CancelSheet({ appointment, location, onClose, onCancelled }: Props) {
  const t = useTranslations("me.cancelSheet");
  const errorText = useFallbackErrorText();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tooLate, setTooLate] = useState(false);
  const first = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    first.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function submit() {
    setBusy(true);
    setError(null);
    const trimmed = reason.trim();
    try {
      const updated = await getBrowserApi().me.cancel(appointment.id, trimmed ? { reason: trimmed } : {});
      onCancelled(updated);
    } catch (err) {
      if (err instanceof ApiError && err.problem.code === "OUTSIDE_CANCEL_WINDOW") setTooLate(true);
      else setError(errorText(err));
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/50 sm:items-center">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="cancel-title"
        className="flex w-full max-w-[480px] flex-col gap-3.5 rounded-t-[22px] bg-card p-5 sm:rounded-[22px]"
      >
        <h2 id="cancel-title" className="font-heading text-xl font-semibold">
          {t("title")}
        </h2>
        {tooLate ? (
          <>
            <CallSalon phone={location.phone} />
            <button
              type="button"
              onClick={onClose}
              className="min-h-[52px] rounded-[14px] bg-plum text-base font-semibold text-white hover:bg-plum-hover"
            >
              {t("close")}
            </button>
          </>
        ) : (
          <>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="cancel-reason" className="text-sm font-semibold">
                {t("reasonLabel")}
              </label>
              <textarea
                id="cancel-reason"
                ref={first}
                rows={3}
                maxLength={200}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                className="w-full rounded-xl border border-line-strong bg-card p-3.5 text-base text-ink"
              />
            </div>
            {error ? (
              <p role="alert" className="text-sm text-warn">
                {error}
              </p>
            ) : null}
            <button
              type="button"
              disabled={busy}
              onClick={() => void submit()}
              className="min-h-[52px] rounded-[14px] bg-plum text-base font-semibold text-white hover:bg-plum-hover disabled:cursor-not-allowed disabled:bg-muted"
            >
              {busy ? t("cancelling") : t("confirm")}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="min-h-11 rounded-[14px] text-[15px] font-semibold text-ink"
            >
              {t("keep")}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
