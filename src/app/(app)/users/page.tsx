import Link from "next/link";
import { requirePermission } from "@/server/auth";
import { can } from "@/server/core/permissions";
import { PASSWORD_RULE } from "@/server/core/users";
import { prisma } from "@/server/db";
import { ActionButton, ActionForm, SubmitButton } from "@/components/forms";
import { Badge, buttonClass, Card, Field, Flash, fmtDate, Input, PageHeader, Select, Table, Td } from "@/components/ui";
import { createUserAction, resetMfaAction, updateUserAction } from "./actions";

export const metadata = { title: "Users" };

function GroupSelect({ groups, value }: { groups: { id: string; name: string }[]; value?: string }) {
  return (
    <Select name="groupId" defaultValue={value ?? ""} required>
      {!value && <option value="" disabled>Choose a group…</option>}
      {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
    </Select>
  );
}

export default async function UsersPage({ searchParams }: PageProps<"/users">) {
  const me = await requirePermission("users", "view");
  const { add, flash } = await searchParams;
  const [users, groups] = await Promise.all([
    prisma.user.findMany({ orderBy: [{ active: "desc" }, { name: "asc" }], include: { group: { select: { id: true, name: true } } } }),
    prisma.userGroup.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);
  const canEdit = can(me, "users", "edit");
  const canDeactivate = can(me, "users", "delete");
  const canCreate = can(me, "users", "create");
  const canGroups = can(me, "users", "groups");
  const adding = canCreate && add === "1";

  return (
    <>
      <Flash message={flash} />
      <PageHeader title="Users" subtitle="Each user belongs to a group; the group decides what they can do. Accounts are deactivated, never deleted."
        actions={<>
          {canGroups && <Link href="/users/groups" className={buttonClass("secondary")}>Manage groups</Link>}
          {canCreate && !adding && <Link href="/users?add=1" className={buttonClass("primary")}>Add user</Link>}
        </>} />
      <div className="space-y-6">
        {adding && (
          <Card title="Add user" actions={<Link href="/users" className={buttonClass("secondary", "sm")}>Cancel</Link>}>
            <ActionForm action={createUserAction} className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <Field label="Name *"><Input name="name" required autoFocus /></Field>
                <Field label="Email *"><Input name="email" type="email" required /></Field>
                <Field label="Group *"><GroupSelect groups={groups} /></Field>
                <Field label="Initial password *" hint={PASSWORD_RULE}><Input name="password" type="password" required autoComplete="new-password" /></Field>
              </div>
              <SubmitButton>Create user</SubmitButton>
            </ActionForm>
          </Card>
        )}
        <Card title={`Users (${users.length})`}>
          <Table head={["Name", "Email", "Group", "Status", "2FA", "Last sign-in", canEdit ? "" : null].filter((h) => h !== null)}>
            {users.map((u) => (
              <tr key={u.id}>
                <Td className="font-medium">{u.name}</Td>
                <Td>{u.email}</Td>
                <Td>{canGroups ? <Link href={`/users/groups/${u.group.id}`} className="text-brand-700 hover:underline">{u.group.name}</Link> : u.group.name}</Td>
                <Td>{u.active ? <Badge tone="green">Active</Badge> : <Badge>Inactive</Badge>}</Td>
                <Td>{u.mfaEnabled ? <Badge tone="green">On</Badge> : <span className="text-slate-400">Off</span>}</Td>
                <Td>{u.lastLoginAt ? fmtDate(u.lastLoginAt) : "—"}</Td>
                {canEdit && (
                  <Td>
                    <details>
                      <summary className="cursor-pointer text-xs text-brand-700">Edit</summary>
                      <div className="mt-2 w-72">
                        <ActionForm action={updateUserAction.bind(null, u.id)} className="space-y-2">
                          <Field label="Name"><Input name="name" defaultValue={u.name} required /></Field>
                          <Field label="Email"><Input name="email" type="email" defaultValue={u.email} required /></Field>
                          <Field label="Group"><GroupSelect groups={groups} value={u.groupId} /></Field>
                          <Field label="New password" hint="Leave blank to keep the current one"><Input name="password" type="password" autoComplete="new-password" /></Field>
                          {canDeactivate
                            ? <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="active" defaultChecked={u.active} /> Active</label>
                            : u.active && <input type="hidden" name="active" value="on" />}
                          <SubmitButton size="sm">Save</SubmitButton>
                        </ActionForm>
                        {u.mfaEnabled && (
                          <div className="mt-3"><ActionButton action={resetMfaAction.bind(null, u.id)} label="Reset two-factor" variant="ghost"
                            confirm="Reset two-factor for this user? They will be signed out and can sign in with just their password." /></div>
                        )}
                      </div>
                    </details>
                  </Td>
                )}
              </tr>
            ))}
          </Table>
        </Card>
      </div>
    </>
  );
}
