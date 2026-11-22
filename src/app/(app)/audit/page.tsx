import Link from "next/link";
import { requirePermission } from "@/server/auth";
import { prisma } from "@/server/db";
import { buttonClass, Card, Input, PageHeader, Table, Td } from "@/components/ui";

export const metadata = { title: "Audit log" };

const LINKS: Record<string, string> = { Client: "/clients/", Project: "/projects/", PurchaseOrder: "/pos/", Invoice: "/invoices/" };

export default async function AuditPage({ searchParams }: PageProps<"/audit">) {
  await requirePermission("audit");
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q.trim() : "";
  const page = Math.max(1, Number(sp.page) || 1);
  const where = q ? { OR: [{ action: { contains: q, mode: "insensitive" as const } }, { entityType: { contains: q, mode: "insensitive" as const } }, { entityId: q }] } : {};
  const logs = await prisma.auditLog.findMany({
    where, orderBy: { createdAt: "desc" }, take: 100, skip: (page - 1) * 100, include: { actor: { select: { name: true } } },
  });
  return (
    <>
      <PageHeader title="Audit log" subtitle="Append-only record of material actions. Entries cannot be edited or deleted." />
      <Card>
        <form className="mb-4 flex gap-2">
          <Input name="q" defaultValue={q} placeholder="Filter by action, entity type or id…" className="max-w-sm" />
          <button className={buttonClass("secondary")}>Filter</button>
        </form>
        <Table head={["When", "Who", "Action", "Record", "Details"]} empty="No entries.">
          {logs.map((l) => (
            <tr key={l.id}>
              <Td className="whitespace-nowrap text-xs">{l.createdAt.toISOString().slice(0, 19).replace("T", " ")}</Td>
              <Td>{l.actor?.name ?? "system"}</Td>
              <Td className="font-mono text-xs">{l.action}</Td>
              <Td className="text-xs">{LINKS[l.entityType] && l.entityId !== "*" ? <Link className="text-indigo-700 hover:underline" href={LINKS[l.entityType] + l.entityId}>{l.entityType}</Link> : l.entityType}</Td>
              <Td className="max-w-md text-xs">
                {l.reason && <div className="text-slate-700">Reason: {l.reason}</div>}
                {(l.before || l.after) && (
                  <details>
                    <summary className="cursor-pointer text-indigo-700">Changes</summary>
                    <pre className="mt-1 max-h-64 overflow-auto rounded bg-slate-50 p-2 text-[11px]">{JSON.stringify({ before: l.before, after: l.after }, null, 2)}</pre>
                  </details>
                )}
              </Td>
            </tr>
          ))}
        </Table>
        <div className="mt-4 flex gap-2">
          {page > 1 && <Link className={buttonClass("secondary", "sm")} href={`/audit?q=${encodeURIComponent(q)}&page=${page - 1}`}>Newer</Link>}
          {logs.length === 100 && <Link className={buttonClass("secondary", "sm")} href={`/audit?q=${encodeURIComponent(q)}&page=${page + 1}`}>Older</Link>}
        </div>
      </Card>
    </>
  );
}
