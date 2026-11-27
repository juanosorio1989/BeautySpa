"use client";

import type { StaffMe } from "@beautyspa/contracts";
import { createContext, useContext } from "react";

export const StaffContext = createContext<StaffMe | null>(null);

/** The signed-in staff member; only valid below `StaffGate`. */
export function useStaff(): StaffMe {
  const ctx = useContext(StaffContext);
  if (!ctx) throw new Error("useStaff must be used inside StaffGate");
  return ctx;
}
