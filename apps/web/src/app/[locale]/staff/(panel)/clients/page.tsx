import { ClientSearch } from "@/components/staff/clients/client-search";
import { RoleGuard } from "@/components/staff/role-guard";

export default function StaffClientsPage() {
  return (
    <RoleGuard allow={["OWNER", "RECEPTION"]}>
      <ClientSearch />
    </RoleGuard>
  );
}
