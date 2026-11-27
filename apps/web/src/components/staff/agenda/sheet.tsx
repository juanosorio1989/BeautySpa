"use client";

import { useEffect, useRef } from "react";

/** Bottom sheet on phones, centered card on wide screens; a native modal (focus trap, inert background). */
export function Sheet({
  titleId,
  onClose,
  children,
}: {
  titleId: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const onCloseRef = useRef(onClose);
  const unmounting = useRef(false);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const el = dialog.current;
    el?.showModal();
    return () => {
      unmounting.current = true; // our own close() must not close the next sheet
      if (el?.open) el.close();
      opener?.focus();
    };
  }, []);

  return (
    <dialog
      ref={dialog}
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        onCloseRef.current();
      }}
      onClose={() => {
        if (!unmounting.current) onCloseRef.current();
      }}
      className="m-0 mt-auto max-h-[92vh] w-full max-w-none overflow-y-auto bg-transparent p-0 backdrop:bg-ink/50 sm:m-auto sm:max-w-[520px]"
    >
      <div className="flex w-full flex-col gap-3.5 rounded-t-[22px] bg-card p-5 sm:rounded-[22px]">{children}</div>
    </dialog>
  );
}
