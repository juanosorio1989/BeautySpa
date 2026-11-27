"use client";

import { ApiError } from "@beautyspa/api-client";
import type { Agenda, StaffAppointment, StatusChange } from "@beautyspa/contracts";
import type { Locale } from "@beautyspa/i18n";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Link } from "@/i18n/navigation";
import { getBrowserApi } from "@/lib/api/browser";
import { formatTime, formatTimeRange } from "@/lib/format";
import { localized } from "@/lib/localized";
import { allowedActions, type StaffAction } from "@/lib/staff/actions";
import { useStaff } from "@/lib/staff/use-staff";
import { useErrorText } from "@/lib/use-error-text";
import { Sheet } from "./sheet";

const STATUS_OF: Record<Exclude<StaffAction, "move">, StatusChange["status"]> = {
  checkIn: "CHECKED_IN",
  complete: "COMPLETED",
  noShow: "NO_SHOW",
  cancel: "CANCELLED",
};

export function ActionSheet({
  appointment,
  agenda,
  now,
  locale,
  onClose,
  onChanged,
  onMove,
}: {
  appointment: StaffAppointment;
  agenda: Agenda;
  now: number;
  locale: Locale;
  onClose: () => void;
  /** Refetch the agenda. */
  onChanged: () => Promise<void> | void;
  onMove: () => void;
}) {
  const t = useTranslations("staff.agenda");
  const errorText = useErrorText();
  const staff = useStaff();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<StaffAction | null>(null);
  const [reason, setReason] = useState("");

  const a = appointment;
  const actions = allowedActions(a, { role: staff.role, meId: staff.id, now, timeZone: agenda.timezone });
  const canSeeClient = staff.role !== "EMPLOYEE";
  const wholeNeedsConfirm = staff.role === "EMPLOYEE" && a.segments.some((s) => s.employeeId !== staff.id);
  const name = a.customer ? (a.customer.name ?? t("unnamedClient")) : t("walkInClient");

  async function run(action: Exclude<StaffAction, "move">) {
    setBusy(true);
    setError(null);
    try {
      const status = STATUS_OF[action];
      const trimmed = reason.trim();
      await getBrowserApi().staff.setStatus(
        a.id,
        action === "cancel" && trimmed ? { status, reason: trimmed } : { status },
      );
      await onChanged();
      onClose();
    } catch (err) {
      if (err instanceof ApiError && err.problem.code === "CONFLICT") {
        setError(t("changed"));
        setConfirming(null);
        await onChanged();
      } else {
        setError(errorText(err));
      }
    } finally {
      setBusy(false);
    }
  }

  function press(action: StaffAction) {
    if (action === "move") return onMove();
    if (action === "cancel") return setConfirming("cancel");
    if (wholeNeedsConfirm) return setConfirming(action);
    void run(action);
  }

  const services = a.segments
    .map((s) => agenda.services.find((x) => x.id === s.serviceId))
    .map((s) => (s ? localized(s.name, locale) : ""))
    .filter(Boolean)
    .join(", ");

  return (
    <Sheet titleId="action-title" onClose={onClose}>
      <div>
        <h2 id="action-title" className="font-heading text-xl font-semibold">
          {name}
        </h2>
        <p className="text-sm text-muted">
          {services} · {formatTimeRange(a.startsAt, a.endsAt, agenda.timezone, locale)} · {t(`status.${a.status}`)}
        </p>
      </div>
      <dl className="flex flex-col gap-1.5 text-sm">
        {a.customer ? (
          <div className="flex flex-wrap items-center gap-x-3">
            <dt className="font-semibold">{t("phone")}</dt>
            <dd>
              <a href={`tel:${a.customer.phoneE164}`} className="flex min-h-11 items-center font-medium underline">
                {a.customer.phoneE164}
              </a>
            </dd>
            {canSeeClient ? (
              <dd>
                <Link
                  href={`/staff/clients/${a.customer.id}`}
                  className="flex min-h-11 items-center font-medium underline"
                >
                  {t("viewClient")}
                </Link>
              </dd>
            ) : null}
          </div>
        ) : null}
        {a.notes ? (
          <div>
            <dt className="font-semibold">{t("notes")}</dt>
            <dd className="whitespace-pre-wrap">{a.notes}</dd>
          </div>
        ) : null}
      </dl>
      {error ? (
        <p role="alert" className="rounded-xl bg-warn-bg p-3 text-sm text-warn">
          {error}
        </p>
      ) : null}
      {confirming === "cancel" ? (
        <div className="flex flex-col gap-2">
          <label htmlFor="staff-cancel-reason" className="text-sm font-semibold">
            {t("cancelReason")}
          </label>
          <textarea
            id="staff-cancel-reason"
            rows={3}
            maxLength={200}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="w-full rounded-xl border border-line-strong bg-card p-3.5 text-base text-ink"
          />
          <button
            type="button"
            disabled={busy}
            onClick={() => void run("cancel")}
            className="min-h-[52px] rounded-[14px] bg-plum text-base font-semibold text-white hover:bg-plum-hover disabled:bg-muted"
          >
            {busy ? t("working") : t("cancelConfirm")}
          </button>
          <button
            type="button"
            onClick={() => setConfirming(null)}
            className="min-h-11 rounded-[14px] text-[15px] font-semibold"
          >
            {t("keep")}
          </button>
        </div>
      ) : confirming ? (
        <div className="flex flex-col gap-2">
          <p className="text-sm">{t("wholeAppointment")}</p>
          <button
            type="button"
            disabled={busy}
            onClick={() => void run(confirming as Exclude<StaffAction, "move">)}
            className="min-h-[52px] rounded-[14px] bg-plum text-base font-semibold text-white hover:bg-plum-hover disabled:bg-muted"
          >
            {busy ? t("working") : t("confirm")}
          </button>
          <button
            type="button"
            onClick={() => setConfirming(null)}
            className="min-h-11 rounded-[14px] text-[15px] font-semibold"
          >
            {t("close")}
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {actions.map(({ action, enabledFrom }) => {
            const disabled = busy || enabledFrom !== undefined;
            const label =
              enabledFrom !== undefined
                ? t("noShowFrom", { time: formatTime(new Date(enabledFrom).toISOString(), agenda.timezone, locale) })
                : t(`actions.${action}`);
            return (
              <button
                key={action}
                type="button"
                disabled={disabled}
                onClick={() => press(action)}
                className={`min-h-[52px] rounded-[14px] text-base font-semibold disabled:cursor-not-allowed disabled:opacity-60 ${
                  action === "checkIn" || action === "complete"
                    ? "bg-ink text-white"
                    : "border border-line-strong bg-card text-ink"
                }`}
              >
                {label}
              </button>
            );
          })}
          <button type="button" onClick={onClose} className="min-h-11 rounded-[14px] text-[15px] font-semibold">
            {t("close")}
          </button>
        </div>
      )}
    </Sheet>
  );
}
