import type { ReactNode } from "react";

export const INPUT_CLASS =
  "min-h-[52px] w-full rounded-xl border border-line-strong bg-card px-3.5 text-base text-ink placeholder:text-muted";

/** A labelled form field with an optional inline error (announced via `role="alert"`). */
export function Field({
  id,
  label,
  error,
  children,
}: {
  id: string;
  label: string;
  error?: string | undefined;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-semibold">
        {label}
      </label>
      {children}
      {error ? (
        <p id={`${id}-error`} role="alert" className="text-sm text-warn">
          {error}
        </p>
      ) : null}
    </div>
  );
}
