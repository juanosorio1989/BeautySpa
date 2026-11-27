"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { INPUT_CLASS } from "@/components/booking/field";
import { Link } from "@/i18n/navigation";
import { formatUsPhone } from "@/lib/phone";
import { useCustomerSearch } from "@/lib/staff/use-customer-search";
import { useErrorText } from "@/lib/use-error-text";

/** Staff client search: results link to the client detail page. */
export function ClientSearch() {
  const t = useTranslations("staff.clientsPage");
  const errorText = useErrorText();
  const [q, setQ] = useState("");
  const search = useCustomerSearch(q);

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-3 px-5 py-6">
      <h1 className="font-heading text-xl font-bold">{t("title")}</h1>
      <label htmlFor="clients-q" className="text-[13px] font-semibold uppercase text-muted">
        {t("searchLabel")}
      </label>
      <input
        id="clients-q"
        type="search"
        value={q}
        autoComplete="off"
        placeholder={t("searchPlaceholder")}
        onChange={(e) => setQ(e.target.value)}
        className={`${INPUT_CLASS} border-2 border-plum`}
      />
      <div className="flex flex-col rounded-xl bg-card">
        {!search.active ? <p className="px-3.5 py-3 text-sm text-muted">{t("hint")}</p> : null}
        {search.loading ? <p className="px-3.5 py-3 text-sm text-muted">{t("searching")}</p> : null}
        {search.error ? (
          <p role="alert" className="px-3.5 py-3 text-sm text-warn">
            {errorText(search.error)}
          </p>
        ) : null}
        {search.active && !search.loading && !search.error && search.results.length === 0 ? (
          <p className="px-3.5 py-3 text-sm text-muted">{t("noResults")}</p>
        ) : null}
        {search.results.map((c) => (
          <Link
            key={c.id}
            href={`/staff/clients/${c.id}`}
            className="flex min-h-14 flex-col items-start justify-center gap-0.5 border-b border-line px-3.5 py-1.5"
          >
            <span className="text-[15px] font-semibold">{c.name ?? t("client")}</span>
            <span className="text-[13px] text-muted">{formatUsPhone(c.phoneE164)}</span>
          </Link>
        ))}
        <Link href="/staff/book" className="flex min-h-12 items-center px-3.5 text-sm font-semibold text-plum">
          {t("newClient")}
        </Link>
      </div>
    </div>
  );
}
