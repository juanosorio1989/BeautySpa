import type { ReactNode } from "react";

/** Sticky bottom action bar shared by the booking steps. */
export function BookingFooter({
  children,
  actionLabel,
  onAction,
  disabled,
}: {
  children: ReactNode;
  actionLabel: string;
  onAction: () => void;
  disabled?: boolean;
}) {
  return (
    <footer className="fixed inset-x-0 bottom-0 border-t border-line bg-card">
      <div className="mx-auto flex max-w-[480px] flex-col gap-2.5 px-5 pb-7 pt-4">
        <div className="flex flex-col gap-0.5 text-sm text-ink">{children}</div>
        <button
          type="button"
          onClick={onAction}
          disabled={disabled}
          className="flex min-h-[52px] items-center justify-center rounded-[14px] bg-plum px-4 text-base font-semibold text-white hover:bg-plum-hover disabled:cursor-not-allowed disabled:bg-muted"
        >
          {actionLabel}
        </button>
      </div>
    </footer>
  );
}
