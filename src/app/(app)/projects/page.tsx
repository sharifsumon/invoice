import Link from "next/link";
import { ProjectStatus } from "@/generated/prisma/enums";
import type { Prisma } from "@/generated/prisma/client";
import { requirePermission } from "@/server/auth";
import { can } from "@/server/core/permissions";
import { prisma } from "@/server/db";
import { Money } from "@/components/money";
import { buttonClass, Card, fmtDate, Input, labelize, LinkButton, PageHeader, Select, StatusBadge, Table, Td } from "@/components/ui";

export const metadata = { title: "Projects" };

export default async function ProjectsPage({ searchParams }: PageProps<"/projects">) {
  const user = await requirePermission("projects");
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q.trim() : "";
  const status = typeof sp.status === "string" && sp.status in ProjectStatus ? (sp.status as ProjectStatus) : undefined;
  const where: Prisma.ProjectWhereInput = {
    status,
    ...(q ? { OR: [
      { name: { contains: q, mode: "insensitive" } },
      { code: { contains: q, mode: "insensitive" } },
      { client: { name: { contains: q, mode: "insensitive" } } },
    ] } : {}),
  };
  const projects = await prisma.project.findMany({
    where, orderBy: { createdAt: "desc" }, take: 200,
    include: { client: { select: { id: true, name: true } }, manager: { select: { name: true } }, _count: { select: { purchaseOrders: true } } },
  });

  return (
    <>
      <PageHeader title="Projects" subtitle={`${projects.length} shown`}
        actions={can(user.role, "projects", "create") && <LinkButton href="/projects/new">New project</LinkButton>} />
      <Card>
        <form className="mb-4 flex flex-wrap gap-2">
          <Input name="q" defaultValue={q} placeholder="Search code, name or client…" className="max-w-xs" />
          <Select name="status" defaultValue={status ?? ""} className="max-w-[180px]">
            <option value="">All statuses</option>
            {Object.values(ProjectStatus).map((s) => <option key={s} value={s}>{labelize(s)}</option>)}
          </Select>
          <button className={buttonClass("secondary")}>Filter</button>
        </form>
        <Table head={["Code", "Project", "Client", "Manager", "Status", "Value", "Approved on", "POs"]} empty="No projects match.">
          {projects.map((p) => (
            <tr key={p.id} className="hover:bg-slate-50">
              <Td><Link href={`/projects/${p.id}`} className="font-medium text-indigo-700 hover:underline">{p.code}</Link></Td>
              <Td>{p.name}</Td>
              <Td><Link href={`/clients/${p.client.id}`} className="hover:underline">{p.client.name}</Link></Td>
              <Td>{p.manager?.name ?? "—"}</Td>
              <Td><StatusBadge status={p.status} /></Td>
              <Td><Money v={p.value} cur={p.currency} /></Td>
              <Td>{fmtDate(p.approvalDate)}</Td>
              <Td className="tabular">{p._count.purchaseOrders}</Td>
            </tr>
          ))}
        </Table>
      </Card>
    </>
  );
}
