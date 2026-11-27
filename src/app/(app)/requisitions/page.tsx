import Link from "next/link";
import type { Prisma } from "@/generated/prisma/client";
import { RequisitionStatus } from "@/generated/prisma/enums";
import { requireUser } from "@/server/auth";
import { can } from "@/server/core/permissions";
import { prisma } from "@/server/db";
import { Money } from "@/components/money";
import { Badge, buttonClass, Card, fmtDate, Input, labelize, PageHeader, Select, Stat, StatusBadge, Table, Td } from "@/components/ui";
import { redirect } from "next/navigation";

export const metadata = { title: "Requisitions" };

const PRIORITY_TONE = { LOW: "slate", NORMAL: "blue", HIGH: "amber", URGENT: "red" } as const;

export default async function RequisitionsPage({ searchParams }: PageProps<"/requisitions">) {
  const user = await requireUser();
  const seeAll = can(user, "requisitions", "view");
  const canCreate = can(user, "requisitions", "create");
  if (!seeAll && !canCreate) redirect("/dashboard?denied=1");

  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q.trim() : "";
  const status = typeof sp.status === "string" && sp.status in RequisitionStatus ? (sp.status as RequisitionStatus) : undefined;
  const mine = sp.mine === "1" || !seeAll;

  const where: Prisma.RequisitionWhereInput = {
    ...(mine ? { requestedById: user.id } : {}),
    ...(status ? { status } : {}),
    ...(q ? { OR: [
      { title: { contains: q, mode: "insensitive" } }, { number: { contains: q, mode: "insensitive" } },
      { department: { name: { contains: q, mode: "insensitive" } } }, { items: { some: { description: { contains: q, mode: "insensitive" } } } },
    ] } : {}),
  };
  const [rows, counts] = await Promise.all([
    prisma.requisition.findMany({
      where, orderBy: { createdAt: "desc" }, take: 300,
      include: { requestedBy: { select: { name: true } }, department: { select: { name: true } }, _count: { select: { items: true } } },
    }),
    prisma.requisition.groupBy({ by: ["status"], where: mine ? { requestedById: user.id } : {}, _count: true }),
  ]);
  const count = (s: RequisitionStatus) => counts.find((c) => c.status === s)?._count ?? 0;
  const filtered = !!(q || status || (seeAll && sp.mine === "1"));

  return (
    <>
      <PageHeader title="Requisitions" subtitle={mine ? "Your requests for items" : "Requests for items across the company"}
        actions={<>
          {can(user, "settings", "administer") && <Link href="/departments" className={buttonClass("secondary")}>Manage departments</Link>}
          {canCreate && <Link href="/requisitions/new" className={buttonClass("primary")}>New requisition</Link>}
        </>} />

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Waiting for approval" value={count("SUBMITTED")} />
        <Stat label="Approved, to fulfil" value={count("APPROVED")} />
        <Stat label="Drafts" value={count("DRAFT")} />
        <Stat label="Fulfilled" value={count("FULFILLED")} />
      </div>

      <Card>
        <form className="mb-4 flex flex-wrap gap-2">
          <Input name="q" defaultValue={q} placeholder="Number, title, department or item…" className="max-w-xs" />
          <Select name="status" defaultValue={status ?? ""} className="max-w-[180px]">
            <option value="">All statuses</option>
            {Object.values(RequisitionStatus).map((s) => <option key={s} value={s}>{labelize(s)}</option>)}
          </Select>
          {seeAll && (
            <Select name="mine" defaultValue={sp.mine === "1" ? "1" : ""} className="max-w-[180px]">
              <option value="">Everyone&apos;s</option>
              <option value="1">Only mine</option>
            </Select>
          )}
          <button className={buttonClass("secondary")}>Filter</button>
          {filtered && <Link href="/requisitions" className={buttonClass("ghost")}>Clear</Link>}
        </form>

        <Table head={["Requisition", "Requested by", "Items", "Priority", "Needed by", "Est. total", "Status"]}
          empty={canCreate ? <>No requisitions yet. <Link href="/requisitions/new" className="font-semibold text-brand-700 underline underline-offset-2">Create one</Link></> : "No requisitions yet."}>
          {rows.map((r) => (
            <tr key={r.id}>
              <Td className="min-w-[240px] whitespace-normal">
                <Link href={`/requisitions/${r.id}`} className="font-medium text-brand-700 hover:underline">{r.title}</Link>
                <div className="text-xs text-slate-400">{r.number ?? "Draft"}{r.department ? ` · ${r.department.name}` : ""}</div>
              </Td>
              <Td>{r.requestedBy.name}<div className="text-xs text-slate-400">{fmtDate(r.createdAt)}</div></Td>
              <Td className="tabular">{r._count.items}</Td>
              <Td><Badge tone={PRIORITY_TONE[r.priority]}>{labelize(r.priority)}</Badge></Td>
              <Td>{fmtDate(r.neededBy)}</Td>
              <Td>{r.estimatedTotal.gt(0) ? <Money v={r.estimatedTotal} cur={r.currency} /> : <span className="text-slate-300">—</span>}</Td>
              <Td><StatusBadge status={r.status} /></Td>
            </tr>
          ))}
        </Table>
      </Card>
    </>
  );
}
