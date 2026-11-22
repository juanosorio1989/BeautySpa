"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { getBrowserApi } from "@/lib/api/browser";
import { useFallbackErrorText } from "@/lib/use-error-text";

export const EXPORT_FILENAME = "beautyspa-my-data.json";

/** "Download my data": saves `GET /me/export` as a JSON file through a Blob object URL. */
export function DownloadData() {
  const t = useTranslations("profile");
  const errorText = useFallbackErrorText();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function download() {
    setBusy(true);
    setError(null);
    try {
      const data = await getBrowserApi().me.export();
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = EXPORT_FILENAME;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 0); // after the browser has started the download
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        disabled={busy}
        onClick={() => void download()}
        className="min-h-11 self-start rounded-xl border border-plum px-[18px] text-[15px] font-semibold text-plum disabled:opacity-60"
      >
        {busy ? t("downloading") : t("download")}
      </button>
      {error ? (
        <p role="alert" className="text-sm text-warn">
          {error}
        </p>
      ) : null}
    </div>
  );
}
