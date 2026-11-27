"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { LINK_BUTTON, PRIMARY_BUTTON } from "./code-form";

/** The 10 one-time recovery codes; Continue stays disabled until the person confirms they saved them. */
export function RecoveryCodes({ codes, onContinue }: { codes: readonly string[]; onContinue: () => void }) {
  const t = useTranslations("staff.auth");
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(codes.join("\n"));
      setCopied(true);
    } catch {
      setCopied(false); // the codes stay on screen to copy by hand
    }
  }

  return (
    <section className="flex flex-col gap-3">
      <h2 className="font-heading text-lg font-semibold">{t("recoveryTitle")}</h2>
      <p className="text-sm text-muted">{t("recoveryBody")}</p>
      <ul className="grid grid-cols-2 gap-2 rounded-xl border border-line-strong bg-card p-3 font-mono text-base">
        {codes.map((code) => (
          <li key={code}>{code}</li>
        ))}
      </ul>
      <button type="button" onClick={() => void copy()} className={LINK_BUTTON}>
        {copied ? t("copied") : t("copy")}
      </button>
      <label className="flex min-h-11 items-center gap-3 text-base">
        <input
          type="checkbox"
          checked={saved}
          onChange={(e) => setSaved(e.target.checked)}
          className="size-5 accent-plum"
        />
        {t("saved")}
      </label>
      <button type="button" disabled={!saved} onClick={onContinue} className={PRIMARY_BUTTON}>
        {t("continue")}
      </button>
    </section>
  );
}
