import { useTranslations } from "next-intl";

/** "Too late to change online, call the salon" with a tap-to-call link when the location has a phone. */
export function CallSalon({ phone }: { phone: string | null }) {
  const t = useTranslations("me");
  return (
    <div className="flex flex-col items-start gap-2 rounded-xl bg-warn-bg p-3 text-sm text-warn">
      <p>{t("tooLate")}</p>
      {phone ? (
        <a href={`tel:${phone}`} className="flex min-h-11 items-center font-semibold text-plum-hover underline">
          {t("callSalon", { phone })}
        </a>
      ) : null}
    </div>
  );
}
