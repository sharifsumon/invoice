import Link from "next/link";
import { POStatus } from "@/generated/prisma/enums";
import type { Prisma } from "@/generated/prisma/client";
import { requirePermission } from "@/server/auth";
import { can } from "@/server/core/permissions";
import { prisma } from "@/server/db";
import { Money } from "@/components/money";
import { buttonClass, Card, fmtDate, Input, labelize, LinkButton, PageHeader, Select, StatusBadge, Table, Td } from "@/components/ui";

export const metadata = { title: "Purchase Orders" };

export default async function POsPage({ searchParams }: PageProps<"/pos">) {
  const user = await requirePermission("pos");
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q.trim() : "";
  const status = typeof sp.status === "string" && sp.status in POStatus ? (sp.status as POStatus) : undefined;
  const where: Prisma.PurchaseOrderWhereInput = {
    status,
    ...(q ? { OR: [
      { poNumber: { contains: q, mode: "insensitive" } },
      { project: { OR: [{ code: { contains: q, mode: "insensitive" } }, { name: { contains: q, mode: "insensitive" } }] } },
      { client: { name: { contains: q, mode: "insensitive" } } },
    ] } : {}),
  };
  const pos = await prisma.purchaseOrder.findMany({
    where, orderBy: { poDate: "desc" }, take: 200,
    include: { client: { select: { id: true, name: true } }, project: { select: { id: true, code: true } }, _count: { select: { milestones: true } } },
  });
  // Valid invoiced per PO in one query
  const sums = await prisma.invoice.groupBy({
    by: ["poId"], where: { poId: { in: pos.map((p) => p.id) }, status: { not: "CANCELLED" } },
    _sum: { subtotal: true, discount: true },
  });
  const invoiced = new Map(sums.map((s) => [s.poId, s._sum.subtotal!.minus(s._sum.discount!)]));

  return (
    <>
      <PageHeader title="Purchase Orders" subtitle={`${pos.length} shown`}
        actions={can(user.role, "pos", "create") && <LinkButton href="/pos/new">New PO</LinkButton>} />
      <Card>
        <form className="mb-4 flex flex-wrap gap-2">
          <Input name="q" defaultValue={q} placeholder="Search PO, project or client…" className="max-w-xs" />
          <Select name="status" defaultValue={status ?? ""} className="max-w-[180px]">
            <option value="">All statuses</option>
            {Object.values(POStatus).map((s) => <option key={s} value={s}>{labelize(s)}</option>)}
          </Select>
          <button className={buttonClass("secondary")}>Filter</button>
        </form>
        <Table head={["PO", "Client", "Project", "Date", "Status", "PO value", "Invoiced", "Remaining", "Milestones"]} empty="No purchase orders match.">
          {pos.map((p) => {
            const inv = invoiced.get(p.id);
            return (
              <tr key={p.id} className="hover:bg-slate-50">
                <Td><Link href={`/pos/${p.id}`} className="font-medium text-indigo-700 hover:underline">{p.poNumber}</Link></Td>
                <Td>{p.client.name}</Td>
                <Td><Link href={`/projects/${p.project.id}`} className="hover:underline">{p.project.code}</Link></Td>
                <Td>{fmtDate(p.poDate)}</Td>
                <Td><StatusBadge status={p.status} /></Td>
                <Td><Money v={p.value} cur={p.currency} /></Td>
                <Td>{inv ? <Money v={inv} cur={p.currency} /> : "—"}</Td>
                <Td><Money v={inv ? p.value.minus(inv) : p.value} cur={p.currency} /></Td>
                <Td className="tabular">{p._count.milestones || "—"}</Td>
              </tr>
            );
          })}
        </Table>
      </Card>
    </>
  );
}
