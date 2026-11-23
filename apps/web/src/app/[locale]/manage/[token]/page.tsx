import type { Metadata } from "next";
import { ManageView } from "@/components/manage/manage-view";

/** A bearer link from an email or push: never indexed. */
export const metadata = { robots: { index: false } } satisfies Metadata;

export default async function ManagePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <ManageView token={token} />;
}
