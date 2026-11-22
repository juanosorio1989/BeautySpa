import type { ReactNode } from "react";

/** Action bar shared by the booking steps; sticks to the bottom of the (max 480 px) content column. */
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
    <footer className="sticky bottom-0 mt-6 border-t border-line bg-card">
      <div className="flex flex-col gap-2.5 px-5 pb-7 pt-4">
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
