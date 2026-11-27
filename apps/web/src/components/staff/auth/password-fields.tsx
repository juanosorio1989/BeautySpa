"use client";

import { NewPasswordSchema } from "@beautyspa/contracts";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { errorProps, Field, INPUT_CLASS } from "@/components/booking/field";
import { PRIMARY_BUTTON } from "./code-form";

/** New password + confirmation; the rules come from `NewPasswordSchema`, the API stays the judge. */
export function PasswordFields({
  onSubmit,
  busy,
  error,
  submitLabel,
}: {
  onSubmit: (password: string) => void;
  busy: boolean;
  error?: string | undefined;
  submitLabel: string;
}) {
  const t = useTranslations("staff.auth");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [problem, setProblem] = useState<string | undefined>();

  function submit() {
    const parsed = NewPasswordSchema.safeParse(password);
    if (!parsed.success) {
      setProblem(password.length > 128 ? t("passwordTooLong") : t("passwordTooShort"));
    } else if (password !== confirm) {
      setProblem(t("passwordMismatch"));
    } else {
      setProblem(undefined);
      onSubmit(password);
    }
  }
  const shown = problem ?? error;

  return (
    <form
      className="flex flex-col gap-3"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <Field id="staff-new-password" label={t("newPassword")}>
        <input
          id="staff-new-password"
          type="password"
          autoComplete="new-password"
          value={password}
          aria-describedby="staff-password-rules"
          onChange={(e) => setPassword(e.target.value)}
          className={INPUT_CLASS}
        />
      </Field>
      <p id="staff-password-rules" className="-mt-1 text-sm text-muted">
        {t("passwordRules")}
      </p>
      <Field id="staff-confirm-password" label={t("confirmPassword")} error={shown}>
        <input
          id="staff-confirm-password"
          type="password"
          autoComplete="new-password"
          value={confirm}
          {...errorProps("staff-confirm-password", shown)}
          onChange={(e) => setConfirm(e.target.value)}
          className={INPUT_CLASS}
        />
      </Field>
      <button type="submit" disabled={busy} className={PRIMARY_BUTTON}>
        {submitLabel}
      </button>
    </form>
  );
}
