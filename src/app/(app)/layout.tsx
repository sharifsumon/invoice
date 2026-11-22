import Link from "next/link";
import { after } from "next/server";
import { requireUser } from "@/server/auth";
import { maybeScan } from "@/server/core/notifications";
import { can, ROLE_LABELS, type Module } from "@/server/core/permissions";
import { prisma } from "@/server/db";
import { logout } from "../login/actions";
import { NavLinks } from "./nav-links";

const NAV: { href: string; label: string; module?: Module }[] = [
  { href: "/", label: "Dashboard" },
  { href: "/clients", label: "Clients", module: "clients" },
  { href: "/projects", label: "Projects", module: "projects" },
  { href: "/pos", label: "Purchase Orders", module: "pos" },
  { href: "/invoices", label: "Invoices", module: "invoices" },
  { href: "/reports", label: "Reports", module: "reports" },
  { href: "/settings", label: "Settings", module: "settings" },
  { href: "/users", label: "Users", module: "users" },
  { href: "/audit", label: "Audit Log", module: "audit" },
];

function Bell({ count }: { count: number }) {
  return (
    <Link href="/notifications" aria-label={`Notifications${count ? ` (${count} unread)` : ""}`}
      className="relative inline-flex h-9 w-9 items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100">
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
        <path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
      </svg>
      {count > 0 && (
        <span className="absolute -right-0.5 -top-0.5 min-w-[18px] rounded-full bg-rose-600 px-1 text-center text-[10px] font-semibold leading-[18px] text-white">
          {count > 99 ? "99+" : count}
        </span>
      )}
    </Link>
  );
}

function SearchBox() {
  return (
    <form action="/search" role="search">
      <input name="q" placeholder="Search…" aria-label="Search clients, projects, POs, invoices"
        className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-sm placeholder:text-slate-400 focus:border-indigo-400 focus:bg-white focus:outline-none" />
    </form>
  );
}

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const user = await requireUser();
  const links = NAV.filter((n) => !n.module || can(user.role, n.module, n.module === "settings" || n.module === "users" ? "administer" : "view"));
  const unread = await prisma.notification.count({ where: { userId: user.id, readAt: null } });
  after(() => maybeScan(prisma)); // due/overdue notifications, throttled; also available via /api/cron/notifications
  return (
    <div className="flex min-h-screen">
      <aside className="hidden w-60 shrink-0 flex-col border-r border-slate-200 bg-white md:flex print:hidden">
        <div className="flex items-center justify-between gap-2 px-5 pt-5 pb-3">
          <span className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-600 text-sm font-bold text-white">IC</span>
            <span className="font-semibold">Invoice + CRM</span>
          </span>
          <Bell count={unread} />
        </div>
        <div className="px-3 pb-3"><SearchBox /></div>
        <NavLinks links={links} />
        <div className="mt-auto border-t border-slate-100 p-4 text-sm">
          <Link href="/account" className="block font-medium text-slate-800 hover:text-indigo-700">{user.name}</Link>
          <div className="text-xs text-slate-500">{ROLE_LABELS[user.role]}{user.role === "ADMIN" && !user.mfaEnabled && <span className="text-amber-600"> · 2FA off</span>}</div>
          <div className="mt-2 flex gap-3">
            <Link href="/account" className="text-xs text-slate-500 hover:text-slate-800">My account</Link>
            <form action={logout}><button className="text-xs text-slate-500 hover:text-slate-800">Sign out</button></form>
          </div>
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-3 md:hidden print:hidden">
          <span className="font-semibold">Invoice + CRM</span>
          <div className="flex-1"><SearchBox /></div>
          <Bell count={unread} />
          <form action={logout}><button className="text-xs text-slate-500">Sign out</button></form>
        </header>
        <div className="border-b border-slate-200 bg-white px-2 md:hidden print:hidden"><NavLinks links={links} horizontal /></div>
        <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 md:px-8">{children}</main>
      </div>
    </div>
  );
}
