import { requirePermission } from "@/server/auth";
import { Card, PageHeader } from "@/components/ui";
import { createGroupAction } from "../../actions";
import { GroupForm } from "../group-form";

export const metadata = { title: "New group" };

export default async function NewGroupPage() {
  await requirePermission("users", "groups");
  return (
    <>
      <PageHeader title="New group" back={{ href: "/users/groups", label: "User groups" }} subtitle="Name the group and tick what its members can do." />
      <Card><GroupForm action={createGroupAction} group={{ name: "", description: null, perms: { clients: ["view"], projects: ["view"], pos: ["view"], invoices: ["view"] } }} submitLabel="Create group" /></Card>
    </>
  );
}
