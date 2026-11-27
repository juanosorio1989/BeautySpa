import { ClientDetail } from "@/components/staff/clients/client-detail";
import { RoleGuard } from "@/components/staff/role-guard";

export default async function StaffClientDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <RoleGuard allow={["OWNER", "RECEPTION"]}>
      <ClientDetail customerId={id} />
    </RoleGuard>
  );
}
