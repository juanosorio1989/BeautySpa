import { useTranslations } from "next-intl";
import { formatUsPhone } from "@/lib/phone";

/**
 * "Too late to change online, call the salon" (or `message`) with a tap-to-call link when the
 * location has a phone.
 */
export function CallSalon({
  phone,
  alert = false,
  message,
}: {
  phone: string | null;
  alert?: boolean;
  message?: string;
}) {
  const t = useTranslations("me");
  return (
    <div
      role={alert ? "alert" : undefined}
      className="flex flex-col items-start gap-2 rounded-xl bg-warn-bg p-3 text-sm text-warn"
    >
      <p>{message ?? t("tooLate")}</p>
      {phone ? (
        <a href={`tel:${phone}`} className="flex min-h-11 items-center font-semibold text-plum-hover underline">
          {t("callSalon", { phone: formatUsPhone(phone) })}
        </a>
      ) : null}
    </div>
  );
}
