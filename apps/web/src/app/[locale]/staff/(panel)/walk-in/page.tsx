import { RoleGuard } from "@/components/staff/role-guard";
import { WalkIn } from "@/components/staff/booking/walk-in";

export default function StaffWalkInPage() {
  return (
    <RoleGuard allow={["OWNER", "RECEPTION"]}>
      <WalkIn />
    </RoleGuard>
  );
}
