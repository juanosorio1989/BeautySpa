import type { Metadata } from "next";

/** Private flow: kept out of search results. */
export const metadata = { robots: { index: false } } satisfies Metadata;

export default function PrivateLayout({ children }: { children: React.ReactNode }) {
  return children;
}
