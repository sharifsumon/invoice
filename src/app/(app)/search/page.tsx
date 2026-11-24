import Link from "next/link";
import { requireUser } from "@/server/auth";
import { can, type Module } from "@/server/core/permissions";
import { globalSearch, type SearchHit } from "@/server/core/search";
import { prisma } from "@/server/db";
import { Badge, buttonClass, Card, Input, PageHeader } from "@/components/ui";

export const metadata = { title: "Search" };

const MODULE: Record<SearchHit["type"], Module> = { Client: "clients", Contact: "clients", Project: "projects", PO: "pos", Invoice: "invoices" };

export default async function SearchPage({ searchParams }: PageProps<"/search">) {
  const user = await requireUser();
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q : "";
  const hits = (await globalSearch(prisma, q)).filter((h) => can(user, MODULE[h.type], "view"));
  return (
    <>
      <PageHeader title="Search" subtitle="Clients, contacts, projects, purchase orders and invoices" />
      <Card>
        <form className="mb-5 flex gap-2">
          <Input name="q" defaultValue={q} autoFocus placeholder="Type at least 2 characters…" className="max-w-lg" />
          <button className={buttonClass("primary")}>Search</button>
        </form>
        {q.trim().length >= 2 && hits.length === 0 && <p className="text-sm text-slate-400">No matches for “{q}”.</p>}
        <ul className="divide-y divide-slate-100">
          {hits.map((h, i) => (
            <li key={i}>
              <Link href={h.href} className="flex items-center gap-3 px-2 py-2.5 hover:bg-slate-50">
                <Badge tone={h.type === "Invoice" ? "indigo" : h.type === "PO" ? "purple" : h.type === "Project" ? "blue" : "slate"}>{h.type}</Badge>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-slate-900">{h.title}</span>
                  <span className="block truncate text-xs text-slate-500">{h.subtitle}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </Card>
    </>
  );
}
