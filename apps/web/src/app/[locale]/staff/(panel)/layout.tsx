"use client";

import { StaffGate } from "@/components/staff/staff-gate";
import { StaffTopBar } from "@/components/staff/staff-top-bar";

export default function PanelLayout({ children }: { children: React.ReactNode }) {
  return (
    <StaffGate>
      <StaffTopBar />
      <main className="px-5 pb-10">{children}</main>
    </StaffGate>
  );
}
