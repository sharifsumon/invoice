import Link from "next/link";
import { requirePermission } from "@/server/auth";
import { REPORTS } from "@/server/core/reports";
import { PageHeader } from "@/components/ui";

export const metadata = { title: "Reports" };

export default async function ReportsPage() {
  await requirePermission("reports");
  return (
    <>
      <PageHeader title="Reports" subtitle="Filter, view and export to CSV, Excel or PDF. Totals are per currency unless you choose a reporting currency." />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {REPORTS.map((r) => (
          <Link key={r.id} href={`/reports/${r.id}`} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition hover:border-indigo-300 hover:shadow">
            <div className="font-semibold text-slate-900">{r.title}</div>
            <p className="mt-1 text-sm text-slate-500">{r.description}</p>
          </Link>
        ))}
      </div>
    </>
  );
}
