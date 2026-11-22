import { useTranslations } from "next-intl";
import type { PublicEmployee, PublicService } from "@beautyspa/contracts";
import type { Locale } from "@beautyspa/i18n";
import { localized } from "@/lib/localized";

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("");
}

export function TeamList({
  employees,
  services,
  locale,
}: {
  employees: PublicEmployee[];
  services: PublicService[];
  locale: Locale;
}) {
  const t = useTranslations("team");
  const visible = employees.filter((e) => e.serviceIds.length > 0);
  if (visible.length === 0) return <p className="text-muted">{t("empty")}</p>;
  const byId = new Map(services.map((s) => [s.id, s]));

  return (
    <ul className="grid gap-4 sm:grid-cols-2">
      {visible.map((e) => {
        const names = e.serviceIds.flatMap((id) => {
          const s = byId.get(id);
          return s ? [localized(s.name, locale)] : [];
        });
        return (
          <li key={e.id} className="rounded-2xl border border-line bg-card p-4">
            <div className="flex items-center gap-3">
              {e.photoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- remote host unknown; plain img keeps config free
                <img src={e.photoUrl} alt="" className="size-14 rounded-full object-cover" />
              ) : (
                <span
                  aria-hidden="true"
                  className="flex size-14 items-center justify-center rounded-full bg-plum-tint font-heading text-lg text-plum-hover"
                >
                  {initials(e.displayName)}
                </span>
              )}
              <div>
                <h2 className="font-heading text-lg">{e.displayName}</h2>
                {e.level ? <p className="text-sm text-muted">{localized(e.level.name, locale)}</p> : null}
              </div>
            </div>
            {e.bio ? <p className="mt-3 text-sm">{localized(e.bio, locale)}</p> : null}
            {names.length > 0 ? (
              <p className="mt-3 text-sm text-muted">
                <span className="font-medium text-ink">{t("does")}: </span>
                {names.join(", ")}
              </p>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
