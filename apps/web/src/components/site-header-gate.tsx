"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

const STAFF_PATH = /^\/(en|es)\/staff(\/|$)/;

/** Hides the customer header on staff pages (they have their own top bar). */
export function SiteHeaderGate({ children }: { children: ReactNode }) {
  return STAFF_PATH.test(usePathname()) ? null : children;
}
