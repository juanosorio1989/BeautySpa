import { Suspense } from "react";
import { QuickBooking } from "@/components/staff/booking/quick-booking";
import { RoleGuard } from "@/components/staff/role-guard";

export default function StaffBookPage() {
  return (
    <RoleGuard allow={["OWNER", "RECEPTION"]}>
      <Suspense fallback={null}>
        <QuickBooking />
      </Suspense>
    </RoleGuard>
  );
}
