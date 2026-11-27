"use client";

import type { BookingCatalog } from "@beautyspa/contracts";
import type { Locale } from "@beautyspa/i18n";
import { useTranslations } from "next-intl";
import { localized } from "@/lib/localized";

export const MAX_SERVICES = 4;

type Service = BookingCatalog["services"][number];

function Chip({
  service,
  locale,
  active,
  disabled,
  onClick,
}: {
  service: Service;
  locale: Locale;
  active: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      className={`min-h-11 rounded-full px-3.5 text-sm disabled:opacity-50 ${
        active ? "bg-ink font-semibold text-white" : "border border-line-strong bg-card font-medium text-ink"
      }`}
    >
      {localized(service.name, locale)}
    </button>
  );
}

/** Popular services first, then the full list by category (uncategorized last). Up to 4 selected. */
export function StaffServicePicker({
  catalog,
  selected,
  lastServiceIds,
  locale,
  onChange,
}: {
  catalog: BookingCatalog;
  selected: string[];
  /** The client's last visit; shows "Same as last time" when it still has known services. */
  lastServiceIds?: string[] | undefined;
  locale: Locale;
  onChange: (ids: string[]) => void;
}) {
  const t = useTranslations("staff.book");
  const byId = new Map(catalog.services.map((s) => [s.id, s]));
  const popular = catalog.popularServiceIds.map((sid) => byId.get(sid)).filter((s) => s !== undefined);
  const known = new Set(catalog.categories.map((c) => c.id));
  const groups = [
    ...catalog.categories.map((c) => ({
      key: c.id,
      title: localized(c.name, locale),
      services: catalog.services.filter((s) => s.categoryId === c.id),
    })),
    { key: "other", title: null, services: catalog.services.filter((s) => !s.categoryId || !known.has(s.categoryId)) },
  ].filter((g) => g.services.length > 0);
  const last = (lastServiceIds ?? []).filter((sid) => byId.has(sid)).slice(0, MAX_SERVICES);
  const full = selected.length >= MAX_SERVICES;

  function toggle(sid: string) {
    onChange(selected.includes(sid) ? selected.filter((x) => x !== sid) : [...selected, sid]);
  }

  const chip = (s: Service) => (
    <Chip
      key={s.id}
      service={s}
      locale={locale}
      active={selected.includes(s.id)}
      disabled={full && !selected.includes(s.id)}
      onClick={() => toggle(s.id)}
    />
  );

  return (
    <section role="group" aria-label={t("services")} className="flex flex-col gap-2">
      <span className="text-[13px] font-semibold uppercase text-muted">{t("services")}</span>
      {last.length > 0 ? (
        <button
          type="button"
          onClick={() => onChange(last)}
          className="min-h-12 self-start rounded-xl border-2 border-plum bg-plum-tint px-4 text-sm font-semibold text-plum-hover"
        >
          {t("sameAsLast")}
        </button>
      ) : null}
      {popular.length > 0 ? <div className="flex flex-wrap gap-2">{popular.map(chip)}</div> : null}
      {groups.map((g) => (
        <div key={g.key} className="flex flex-col gap-1.5">
          {g.title ? <span className="text-xs font-semibold text-muted">{g.title}</span> : null}
          <div className="flex flex-wrap gap-2">{g.services.map(chip)}</div>
        </div>
      ))}
      {full ? <p className="text-xs text-muted">{t("maxServices")}</p> : null}
    </section>
  );
}
