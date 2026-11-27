import { Suspense } from "react";
import { AgendaView } from "@/components/staff/agenda/agenda-view";

export default function StaffAgendaPage() {
  return (
    <Suspense fallback={null}>
      <AgendaView />
    </Suspense>
  );
}
