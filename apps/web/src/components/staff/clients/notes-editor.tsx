"use client";

import type { CustomerNotes } from "@beautyspa/contracts";
import type { Locale } from "@beautyspa/i18n";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { getBrowserApi } from "@/lib/api/browser";
import { formatDate } from "@/lib/format";
import { useErrorText } from "@/lib/use-error-text";

export const NOTES_MAX = 2000;

/** Staff-only private notes for one client; a failed save keeps the typed text. */
export function NotesEditor({ customerId, timezone }: { customerId: string; timezone: string }) {
  const t = useTranslations("staff.clientsPage.notes");
  const errorText = useErrorText();
  const locale = useLocale() as Locale;
  const [saved, setSaved] = useState<CustomerNotes | null>(null);
  const [text, setText] = useState("");
  const [loadError, setLoadError] = useState<unknown>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getBrowserApi()
      .staff.notes(customerId)
      .then(
        (n) => {
          if (cancelled) return;
          setSaved(n);
          setText(n.notes ?? "");
        },
        (err: unknown) => !cancelled && setLoadError(err),
      );
    return () => {
      cancelled = true;
    };
  }, [customerId]);

  async function save() {
    setBusy(true);
    setSaveError(null);
    try {
      const n = await getBrowserApi().staff.saveNotes(customerId, { notes: text });
      setSaved(n);
      setText(n.notes ?? "");
    } catch (err) {
      setSaveError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  const when = saved?.updatedAt ? formatDate(saved.updatedAt, timezone, locale, "medium") : null;

  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-[13px] font-semibold uppercase text-muted">{t("title")}</h2>
      <p className="text-sm text-muted">{t("hint")}</p>
      {loadError ? (
        <p role="alert" className="text-sm text-warn">
          {errorText(loadError)}
        </p>
      ) : (
        <>
          <label htmlFor="client-notes" className="sr-only">
            {t("label")}
          </label>
          <textarea
            id="client-notes"
            value={text}
            maxLength={NOTES_MAX}
            rows={5}
            disabled={!saved || busy}
            onChange={(e) => setText(e.target.value)}
            className="w-full rounded-xl border border-line-strong bg-card p-3.5 text-base text-ink"
          />
          <div className="flex items-center justify-between text-sm text-muted">
            <span>
              {when
                ? saved?.updatedBy
                  ? t("saved", { date: when, name: saved.updatedBy.name })
                  : t("savedNoName", { date: when })
                : t("empty")}
            </span>
            <span>{t("count", { count: text.length, max: NOTES_MAX })}</span>
          </div>
          {saveError ? (
            <p role="alert" className="text-sm text-warn">
              {saveError}
            </p>
          ) : null}
          <button
            type="button"
            onClick={() => void save()}
            disabled={busy || !saved}
            className="min-h-[52px] rounded-[14px] bg-plum font-semibold text-white disabled:bg-muted"
          >
            {busy ? t("saving") : t("save")}
          </button>
        </>
      )}
    </section>
  );
}
