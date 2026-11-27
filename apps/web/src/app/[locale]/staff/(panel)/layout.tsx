"use client";

import { Suspense } from "react";
import { StaffGate } from "@/components/staff/staff-gate";
import { StaffTopBar } from "@/components/staff/staff-top-bar";

export default function PanelLayout({ children }: { children: React.ReactNode }) {
  return (
    // StaffGate reads the query string (useSearchParams) for the login `next`.
    <Suspense fallback={null}>
      <StaffGate>
        <StaffTopBar />
        <main className="px-5 pb-10">{children}</main>
      </StaffGate>
    </Suspense>
  );
}
