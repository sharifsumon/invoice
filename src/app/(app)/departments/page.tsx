import Link from "next/link";
import { requirePermission } from "@/server/auth";
import { prisma } from "@/server/db";
import { ActionButton, ActionForm, SubmitButton } from "@/components/forms";
import { Badge, buttonClass, Card, Flash, Input, PageHeader, Table, Td } from "@/components/ui";
import { createDepartmentAction, deleteDepartmentAction, renameDepartmentAction, setDepartmentActiveAction } from "./actions";

export const metadata = { title: "Departments" };

export default async function DepartmentsPage({ searchParams }: PageProps<"/departments">) {
  await requirePermission("settings", "administer");
  const { flash, edit } = await searchParams;
  const departments = await prisma.department.findMany({
    orderBy: [{ active: "desc" }, { name: "asc" }],
    include: { _count: { select: { requisitions: true } } },
  });

  return (
    <>
      <Flash message={flash} />
      <PageHeader title="Departments" subtitle="These departments appear in the Department dropdown on requisitions."
        actions={<Link href="/requisitions" className={buttonClass("secondary")}>Go to requisitions</Link>} />

      <Card title="Add department">
        <ActionForm action={createDepartmentAction} resetOnSuccess>
          <div className="flex flex-wrap items-end gap-2">
            <label className="block min-w-[240px] flex-1">
              <span className="mb-1.5 block text-sm font-medium text-slate-700">Department name</span>
              <Input name="name" required maxLength={120} placeholder="e.g. Engineering" />
            </label>
            <SubmitButton pendingText="Adding…">Add department</SubmitButton>
          </div>
        </ActionForm>
      </Card>

      <div className="mt-6">
        <Card title={`All departments (${departments.length})`}>
          <Table head={["Department", "Requisitions", "Status", ""]} empty="No departments yet. Add the first one above.">
            {departments.map((d) => (
              <tr key={d.id}>
                <Td className="min-w-[260px]">
                  {edit === d.id ? (
                    <ActionForm action={renameDepartmentAction.bind(null, d.id)}>
                      <div className="flex flex-wrap items-center gap-2">
                        <Input name="name" required maxLength={120} defaultValue={d.name} aria-label={`New name for ${d.name}`} className="max-w-xs" autoFocus />
                        <SubmitButton size="sm">Save</SubmitButton>
                        <Link href="/departments" className={buttonClass("ghost", "sm")}>Cancel</Link>
                      </div>
                    </ActionForm>
                  ) : <span className="font-medium">{d.name}</span>}
                </Td>
                <Td className="tabular">{d._count.requisitions}</Td>
                <Td>{d.active ? <Badge dot tone="green">Active</Badge> : <Badge dot tone="slate">Inactive</Badge>}</Td>
                <Td>
                  {edit !== d.id && (
                    <div className="flex flex-wrap justify-end gap-2">
                      <Link href={`/departments?edit=${d.id}`} className={buttonClass("secondary", "sm")} aria-label={`Rename ${d.name}`}>Rename</Link>
                      {d.active
                        ? <ActionButton action={setDepartmentActiveAction.bind(null, d.id, false)} label="Deactivate" confirm={`Deactivate ${d.name}? It stays on existing requisitions but can't be picked for new ones.`} />
                        : <ActionButton action={setDepartmentActiveAction.bind(null, d.id, true)} label="Activate" />}
                      {d._count.requisitions === 0 && (
                        <ActionButton action={deleteDepartmentAction.bind(null, d.id)} label="Delete" variant="danger" confirm={`Delete ${d.name}?`} />
                      )}
                    </div>
                  )}
                </Td>
              </tr>
            ))}
          </Table>
        </Card>
      </div>
    </>
  );
}
