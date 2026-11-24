import Link from "next/link";
import { requirePermission } from "@/server/auth";
import { ACTION_LABELS, MODULES, normalizePerms } from "@/server/core/permissions";
import { prisma } from "@/server/db";
import { Card, Flash, LinkButton, PageHeader, Table, Td } from "@/components/ui";

export const metadata = { title: "User groups" };

export default async function GroupsPage({ searchParams }: PageProps<"/users/groups">) {
  await requirePermission("users", "groups");
  const { flash } = await searchParams;
  const groups = await prisma.userGroup.findMany({ orderBy: { name: "asc" }, include: { _count: { select: { users: { where: { active: true } } } } } });

  return (
    <>
      <Flash message={flash} />
      <PageHeader title="User groups" back={{ href: "/users", label: "Users" }}
        subtitle="Put users in groups and choose what each group can do. Changes apply on the next page load."
        actions={<LinkButton href="/users/groups/new">New group</LinkButton>} />
      <Card>
        <Table head={["Group", "Users", "Permissions"]} empty="No groups yet.">
          {groups.map((g) => {
            const perms = normalizePerms(g.permissions);
            return (
              <tr key={g.id}>
                <Td className="min-w-[200px] whitespace-normal">
                  <Link href={`/users/groups/${g.id}`} className="font-medium text-brand-700 hover:underline">{g.name}</Link>
                  {g.description && <div className="text-xs text-slate-400">{g.description}</div>}
                </Td>
                <Td className="tabular">{g._count.users}</Td>
                <Td className="whitespace-normal text-xs text-slate-600">
                  {MODULES.filter((m) => perms[m.key]?.length).map((m) => (
                    <div key={m.key}>
                      <span className="font-medium text-slate-800">{m.label}:</span>{" "}
                      {perms[m.key]!.map((a) => m.actions.find((x) => x.key === a)?.label ?? ACTION_LABELS[a]).join(", ")}
                    </div>
                  ))}
                  {!Object.keys(perms).length && <span className="text-slate-400">No access</span>}
                </Td>
              </tr>
            );
          })}
        </Table>
      </Card>
    </>
  );
}
