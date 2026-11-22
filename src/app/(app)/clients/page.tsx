import Link from "next/link";
import { ClientStatus } from "@/generated/prisma/enums";
import type { Prisma } from "@/generated/prisma/client";
import { requirePermission } from "@/server/auth";
import { can } from "@/server/core/permissions";
import { prisma } from "@/server/db";
import { Card, Input, labelize, LinkButton, PageHeader, Select, StatusBadge, Table, Td, buttonClass } from "@/components/ui";

export const metadata = { title: "Clients" };

export default async function ClientsPage({ searchParams }: PageProps<"/clients">) {
  const user = await requirePermission("clients");
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q.trim() : "";
  const status = typeof sp.status === "string" && sp.status in ClientStatus ? (sp.status as ClientStatus) : undefined;
  const archived = sp.archived === "1";

  const where: Prisma.ClientWhereInput = {
    archived,
    status,
    ...(q ? {
      OR: [
        { name: { contains: q, mode: "insensitive" } },
        { legalName: { contains: q, mode: "insensitive" } },
        { email: { contains: q, mode: "insensitive" } },
        { contacts: { some: { OR: [{ name: { contains: q, mode: "insensitive" } }, { email: { contains: q, mode: "insensitive" } }] } } },
      ],
    } : {}),
  };
  const clients = await prisma.client.findMany({
    where, orderBy: { name: "asc" }, take: 200,
    include: { contacts: { where: { isPrimary: true }, take: 1 }, _count: { select: { projects: true, purchaseOrders: true } } },
  });

  return (
    <>
      <PageHeader title="Clients" subtitle={`${clients.length} shown`}
        actions={can(user.role, "clients", "create") && <LinkButton href="/clients/new">New client</LinkButton>} />
      <Card>
        <form className="mb-4 flex flex-wrap gap-2">
          <Input name="q" defaultValue={q} placeholder="Search name, email or contact…" className="max-w-xs" />
          <Select name="status" defaultValue={status ?? ""} className="max-w-[180px]">
            <option value="">All statuses</option>
            {Object.values(ClientStatus).map((s) => <option key={s} value={s}>{labelize(s)}</option>)}
          </Select>
          <Select name="archived" defaultValue={archived ? "1" : ""} className="max-w-[160px]">
            <option value="">Active</option>
            <option value="1">Archived</option>
          </Select>
          <button className={buttonClass("secondary")}>Filter</button>
        </form>
        <Table head={["Client", "Status", "Primary contact", "Country", "Projects", "POs"]} empty="No clients match.">
          {clients.map((c) => (
            <tr key={c.id} className="hover:bg-slate-50">
              <Td><Link href={`/clients/${c.id}`} className="font-medium text-indigo-700 hover:underline">{c.name}</Link>
                {c.legalName && <div className="text-xs text-slate-400">{c.legalName}</div>}</Td>
              <Td><StatusBadge status={c.status} /></Td>
              <Td>{c.contacts[0] ? <>{c.contacts[0].name}<div className="text-xs text-slate-400">{c.contacts[0].email}</div></> : "—"}</Td>
              <Td>{c.country ?? "—"}</Td>
              <Td className="tabular">{c._count.projects}</Td>
              <Td className="tabular">{c._count.purchaseOrders}</Td>
            </tr>
          ))}
        </Table>
      </Card>
    </>
  );
}
