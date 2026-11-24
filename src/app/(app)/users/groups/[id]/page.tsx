import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission } from "@/server/auth";
import { normalizePerms } from "@/server/core/permissions";
import { prisma } from "@/server/db";
import { ActionButton } from "@/components/forms";
import { Badge, Card, Flash, PageHeader } from "@/components/ui";
import { deleteGroupAction, updateGroupAction } from "../../actions";
import { GroupForm } from "../group-form";

export const metadata = { title: "Edit group" };

export default async function GroupPage({ params, searchParams }: PageProps<"/users/groups/[id]">) {
  await requirePermission("users", "groups");
  const { id } = await params;
  const { flash } = await searchParams;
  const g = await prisma.userGroup.findUnique({
    where: { id },
    include: { users: { orderBy: [{ active: "desc" }, { name: "asc" }], select: { id: true, name: true, email: true, active: true } } },
  });
  if (!g) notFound();

  return (
    <>
      <Flash message={flash} />
      <PageHeader title={g.name} back={{ href: "/users/groups", label: "User groups" }} subtitle={g.description ?? undefined}
        actions={g.users.length === 0 && (
          <ActionButton action={deleteGroupAction.bind(null, g.id)} label="Delete group" variant="danger" confirm={`Delete the group "${g.name}"?`} />
        )} />
      <div className="space-y-6">
        <Card title="Permissions">
          <GroupForm action={updateGroupAction.bind(null, g.id)} group={{ name: g.name, description: g.description, perms: normalizePerms(g.permissions) }} submitLabel="Save group" />
        </Card>
        <Card title={`Members (${g.users.length})`}>
          {g.users.length ? (
            <ul className="grid gap-x-8 text-sm sm:grid-cols-2 lg:grid-cols-3">
              {g.users.map((u) => (
                <li key={u.id} className="flex items-center justify-between gap-3 border-b border-slate-100 py-2.5">
                  <span className="min-w-0">
                    <span className="block truncate font-medium text-slate-800">{u.name}</span>
                    <span className="block truncate text-xs text-slate-500">{u.email}</span>
                  </span>
                  {!u.active && <Badge>Inactive</Badge>}
                </li>
              ))}
            </ul>
          ) : <p className="text-sm text-slate-500">No users in this group yet.</p>}
          <p className="mt-4 text-xs text-slate-500">
            Move users between groups on the <Link href="/users" className="text-brand-700 hover:underline">Users</Link> page.
            A group can only be deleted once it has no users.
          </p>
        </Card>
      </div>
    </>
  );
}
