import type { Db } from "./common";

export interface SearchHit { type: "Client" | "Contact" | "Project" | "PO" | "Invoice"; title: string; subtitle: string; href: string }

/** BRD §5.9 global search across clients, contacts, projects, POs and invoices. */
export async function globalSearch(db: Db, q: string, take = 10): Promise<SearchHit[]> {
  const s = q.trim();
  if (s.length < 2) return [];
  const ci = { contains: s, mode: "insensitive" as const };
  const [clients, contacts, projects, pos, invoices] = await Promise.all([
    db.client.findMany({ where: { OR: [{ name: ci }, { legalName: ci }, { email: ci }, { taxId: ci }] }, take, orderBy: { name: "asc" } }),
    db.clientContact.findMany({ where: { OR: [{ name: ci }, { email: ci }, { phone: ci }] }, take, include: { client: { select: { id: true, name: true } } } }),
    db.project.findMany({ where: { OR: [{ name: ci }, { code: ci }] }, take, include: { client: { select: { name: true } } } }),
    db.purchaseOrder.findMany({ where: { OR: [{ poNumber: ci }, { reference: ci }] }, take, include: { client: { select: { name: true } } } }),
    db.invoice.findMany({ where: { invoiceNumber: ci }, take, include: { client: { select: { name: true } } } }),
  ]);
  return [
    ...clients.map((c) => ({ type: "Client" as const, title: c.name, subtitle: [c.legalName, c.country, c.archived ? "archived" : null].filter(Boolean).join(" · "), href: `/clients/${c.id}` })),
    ...contacts.map((c) => ({ type: "Contact" as const, title: c.name, subtitle: `${c.client.name}${c.email ? ` · ${c.email}` : ""}`, href: `/clients/${c.client.id}` })),
    ...projects.map((p) => ({ type: "Project" as const, title: `${p.code} — ${p.name}`, subtitle: `${p.client.name} · ${p.status}`, href: `/projects/${p.id}` })),
    ...pos.map((p) => ({ type: "PO" as const, title: `PO ${p.poNumber}`, subtitle: `${p.client.name} · ${p.status}`, href: `/pos/${p.id}` })),
    ...invoices.map((i) => ({ type: "Invoice" as const, title: i.invoiceNumber!, subtitle: `${i.client.name} · ${i.status}`, href: `/invoices/${i.id}` })),
  ];
}
