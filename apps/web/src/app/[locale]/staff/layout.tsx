import type { Metadata } from "next";

/** Staff panel: kept out of search results. */
export const metadata = { robots: { index: false } } satisfies Metadata;

export default function StaffLayout({ children }: { children: React.ReactNode }) {
  return children;
}
