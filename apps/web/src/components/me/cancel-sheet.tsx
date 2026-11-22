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
  const dialog = useRef<HTMLDialogElement>(null);
  const first = useRef<HTMLTextAreaElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  const unmounting = useRef(false);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  // Native modal: focus trap and inert background. Focus goes to the reason once, and back to the opener on unmount.
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const el = dialog.current;
    el?.showModal();
    first.current?.focus();
    return () => {
      unmounting.current = true; // our own close() below must not close the next sheet
      if (el?.open) el.close();
      opener?.focus();
    };
  }, []);

  useEffect(() => {
    if (tooLate) closeButton.current?.focus();
  }, [tooLate]);

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
    <dialog
      ref={dialog}
      aria-labelledby="cancel-title"
      onCancel={(e) => {
        // Escape: ignored while the request runs
        if (busy) e.preventDefault();
        else onCloseRef.current();
      }}
      onClose={() => {
        // The browser closed it anyway (Chrome lets a second Escape through): keep the page in sync.
        if (!unmounting.current) onCloseRef.current();
      }}
      className="m-0 mt-auto w-full max-w-none bg-transparent p-0 backdrop:bg-ink/50 sm:m-auto sm:max-w-[480px]"
    >
      <div className="flex w-full flex-col gap-3.5 rounded-t-[22px] bg-card p-5 sm:rounded-[22px]">
        <h2 id="cancel-title" className="font-heading text-xl font-semibold">
          {t("title")}
        </h2>
        {tooLate ? (
          <>
            <CallSalon phone={location.phone} alert />
            <button
              type="button"
              ref={closeButton}
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
    </dialog>
  );
}
