import { Role } from "@/generated/prisma/enums";
import { requirePermission } from "@/server/auth";
import { PERMISSIONS, ROLE_LABELS } from "@/server/core/permissions";
import { PASSWORD_RULE } from "@/server/core/settings";
import { prisma } from "@/server/db";
import { ActionButton, ActionForm, SubmitButton } from "@/components/forms";
import { Badge, Card, Field, fmtDate, Input, PageHeader, Select, Table, Td } from "@/components/ui";
import { createUserAction, resetMfaAction, updateUserAction } from "./actions";

export const metadata = { title: "Users" };

function RoleSelect({ value }: { value?: Role }) {
  return (
    <Select name="role" defaultValue={value ?? Role.VIEWER}>
      {Object.values(Role).map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
    </Select>
  );
}

export default async function UsersPage() {
  await requirePermission("users", "administer");
  const users = await prisma.user.findMany({ orderBy: [{ active: "desc" }, { name: "asc" }] });
  return (
    <>
      <PageHeader title="Users & roles" subtitle="Accounts are deactivated, never deleted, so their history stays attributable." />
      <div className="grid gap-6 lg:grid-cols-3">
        <Card title="Users" className="lg:col-span-2">
          <Table head={["Name", "Email", "Role", "Status", "2FA", "Last sign-in", ""]}>
            {users.map((u) => (
              <tr key={u.id}>
                <Td className="font-medium">{u.name}</Td>
                <Td>{u.email}</Td>
                <Td>{ROLE_LABELS[u.role]}</Td>
                <Td>{u.active ? <Badge tone="green">Active</Badge> : <Badge>Inactive</Badge>}</Td>
                <Td>{u.mfaEnabled ? <Badge tone="green">On</Badge> : <span className="text-slate-400">Off</span>}</Td>
                <Td>{u.lastLoginAt ? fmtDate(u.lastLoginAt) : "—"}</Td>
                <Td>
                  <details>
                    <summary className="cursor-pointer text-xs text-indigo-700">Edit</summary>
                    <div className="mt-2 w-72">
                      <ActionForm action={updateUserAction.bind(null, u.id)} className="space-y-2">
                        <Field label="Name"><Input name="name" defaultValue={u.name} required /></Field>
                        <Field label="Email"><Input name="email" type="email" defaultValue={u.email} required /></Field>
                        <Field label="Role"><RoleSelect value={u.role} /></Field>
                        <Field label="New password" hint="Leave blank to keep the current one"><Input name="password" type="password" autoComplete="new-password" /></Field>
                        <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="active" defaultChecked={u.active} /> Active</label>
                        <SubmitButton size="sm">Save</SubmitButton>
                      </ActionForm>
                      {u.mfaEnabled && (
                        <div className="mt-3"><ActionButton action={resetMfaAction.bind(null, u.id)} label="Reset two-factor" variant="ghost"
                          confirm="Reset two-factor for this user? They will be signed out and can sign in with just their password." /></div>
                      )}
                    </div>
                  </details>
                </Td>
              </tr>
            ))}
          </Table>
        </Card>
        <div className="space-y-6">
          <Card title="Add user">
            <ActionForm action={createUserAction} resetOnSuccess className="space-y-3">
              <Field label="Name"><Input name="name" required /></Field>
              <Field label="Email"><Input name="email" type="email" required /></Field>
              <Field label="Role"><RoleSelect /></Field>
              <Field label="Initial password" hint={PASSWORD_RULE}><Input name="password" type="password" required autoComplete="new-password" /></Field>
              <SubmitButton>Create user</SubmitButton>
            </ActionForm>
          </Card>
          <Card title="Role permissions">
            <ul className="space-y-3 text-xs">
              {Object.values(Role).map((r) => (
                <li key={r}>
                  <div className="font-medium text-slate-800">{ROLE_LABELS[r]}</div>
                  <div className="text-slate-500">
                    {Object.entries(PERMISSIONS[r]).map(([m, a]) => `${m}: ${a!.join(", ")}`).join(" · ")}
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>
    </>
  );
}
