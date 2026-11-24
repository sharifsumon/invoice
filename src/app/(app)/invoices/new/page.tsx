import Link from "next/link";
import { requirePermission } from "@/server/auth";
import { prisma } from "@/server/db";
import { Money } from "@/components/money";
import { Card, fmtDate, PageHeader, Table, Td } from "@/components/ui";

export const metadata = { title: "New invoice" };

/** Pick the PO to invoice: approved POs with something left to invoice (balance invoices excluded). */
export default async function NewInvoicePage() {
  await requirePermission("invoices", "create");
  const pos = await prisma.purchaseOrder.findMany({
    where: { status: "APPROVED" }, orderBy: { poDate: "desc" },
    include: { client: { select: { name: true } }, project: { select: { code: true, name: true } } },
  });
  const sums = await prisma.invoice.groupBy({
    by: ["poId"], where: { poId: { in: pos.map((p) => p.id) }, status: { not: "CANCELLED" }, kind: { not: "BALANCE" } },
    _sum: { subtotal: true, discount: true },
  });
  const used = new Map(sums.map((s) => [s.poId, s._sum.subtotal!.minus(s._sum.discount!)]));
  const rows = pos.map((p) => ({ p, remaining: p.value.minus(used.get(p.id) ?? 0) })).filter((r) => r.remaining.gt(0));

  return (
    <>
      <PageHeader title="New invoice" back={{ href: "/invoices", label: "Invoices" }}
        subtitle="Every invoice belongs to an approved PO. Choose the PO to invoice." />
      <Card>
        <Table head={["PO", "Client", "Project", "PO date", "PO value", "Left to invoice", ""]}
          empty="No approved PO has anything left to invoice. Approve a PO, or cancel an invoice to free up its amount.">
          {rows.map(({ p, remaining }) => (
            <tr key={p.id}>
              <Td><Link href={`/pos/${p.id}`} className="font-medium text-brand-700 hover:underline">{p.poNumber}</Link></Td>
              <Td>{p.client.name}</Td>
              <Td className="whitespace-normal">{p.project.code} — {p.project.name}</Td>
              <Td>{fmtDate(p.poDate)}</Td>
              <Td><Money v={p.value} cur={p.currency} /></Td>
              <Td><Money v={remaining} cur={p.currency} className="font-semibold" /></Td>
              <Td><Link href={`/pos/${p.id}?invoice=1#new-invoice`} className="rounded-lg bg-brand-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-600">Create invoice</Link></Td>
            </tr>
          ))}
        </Table>
        <p className="mt-4 text-xs text-slate-500">
          To bill the unpaid part of a partially paid invoice, open that invoice (or its PO) and use <b>Create balance invoice</b>.
        </p>
      </Card>
    </>
  );
}
