"use client";

import type { AgendaEmployee } from "@beautyspa/contracts";
import { useTranslations } from "next-intl";

/** Professional chips: tabs on phones (`single`), column filter on wide screens. */
export function EmployeeChips({
  employees,
  selectedIds,
  onToggle,
}: {
  employees: AgendaEmployee[];
  selectedIds: string[];
  onToggle: (id: string) => void;
}) {
  const t = useTranslations("staff.agenda");
  return (
    <nav aria-label={t("professionals")} className="flex flex-wrap gap-1.5">
      {employees.map((e) => {
        const on = selectedIds.includes(e.id);
        return (
          <button
            key={e.id}
            type="button"
            aria-pressed={on}
            onClick={() => onToggle(e.id)}
            className={`min-h-11 rounded-full px-3.5 text-[13px] ${
              on ? "bg-white font-semibold text-ink" : "border border-[#5E534D] font-medium text-white"
            }`}
          >
            {e.displayName}
          </button>
        );
      })}
    </nav>
  );
}
