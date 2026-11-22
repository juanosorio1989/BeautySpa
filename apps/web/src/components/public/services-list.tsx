import { useTranslations } from "next-intl";
import type { PublicServicesResponse } from "@beautyspa/contracts";
import type { Locale } from "@beautyspa/i18n";
import { Link } from "@/i18n/navigation";
import { formatPrice } from "@/lib/format";
import { localized } from "@/lib/localized";

export function ServicesList({ data, locale }: { data: PublicServicesResponse; locale: Locale }) {
  const t = useTranslations("services");
  const categories = [...data.categories].sort((a, b) => a.sort - b.sort);
  const known = new Set(categories.map((c) => c.id));
  const groups = [
    ...categories.map((c) => ({
      id: c.id,
      title: localized(c.name, locale),
      items: data.services.filter((s) => s.categoryId === c.id),
    })),
    {
      id: "other",
      title: t("uncategorized"),
      items: data.services.filter((s) => !s.categoryId || !known.has(s.categoryId)),
    },
  ].filter((g) => g.items.length > 0);

  if (groups.length === 0) return <p className="text-muted">{t("empty")}</p>;

  return (
    <div className="space-y-8">
      {groups.map((g) => (
        <section key={g.id} aria-labelledby={`cat-${g.id}`}>
          <h2 id={`cat-${g.id}`} className="font-heading text-xl">
            {g.title}
          </h2>
          <ul className="mt-3 space-y-3">
            {g.items.map((s) => {
              const name = localized(s.name, locale);
              const description = localized(s.description, locale);
              return (
                <li
                  key={s.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-card p-4"
                >
                  <div className="min-w-0 flex-1 basis-60">
                    <h3 className="font-medium">{name}</h3>
                    {description ? <p className="mt-1 text-sm text-muted">{description}</p> : null}
                    <p className="mt-1 text-sm text-muted">
                      {t("minutes", { count: s.durationMin })}
                      {s.parallelizable ? ` · ${t("parallel")}` : ""}
                    </p>
                  </div>
                  <p className="font-medium">
                    {s.fromPriceCents !== s.priceCents
                      ? t("from", { price: formatPrice(s.fromPriceCents, locale) })
                      : formatPrice(s.priceCents, locale)}
                  </p>
                  <Link
                    href={`/?service=${s.id}`}
                    aria-label={t("bookService", { name })}
                    className="inline-flex min-h-11 items-center rounded-full border border-plum px-5 font-medium"
                  >
                    {t("book")}
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
