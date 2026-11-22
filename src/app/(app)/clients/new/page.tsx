import { requirePermission } from "@/server/auth";
import { Card, PageHeader } from "@/components/ui";
import { ClientForm } from "../client-form";
import { createClientAction } from "../actions";

export const metadata = { title: "New client" };

export default async function NewClientPage() {
  await requirePermission("clients", "create");
  return (
    <>
      <PageHeader title="New client" back={{ href: "/clients", label: "Clients" }} />
      <Card><ClientForm action={createClientAction} withContact submitLabel="Create client" /></Card>
    </>
  );
}
