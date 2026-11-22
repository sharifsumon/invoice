import Link from "next/link";
import { after } from "next/server";
import { Bell, ChevronDown, LogOut, Search, ShieldAlert, UserRound } from "lucide-react";
import { requireUser } from "@/server/auth";
import { maybeScan } from "@/server/core/notifications";
import { can, ROLE_LABELS, type Module } from "@/server/core/permissions";
import { prisma } from "@/server/db";
import { logout } from "../login/actions";
import { CurrentSection, MobileNav, NavLinks, type NavItem } from "./nav-links";

const NAV: (NavItem & { module?: Module })[] = [
  { href: "/", label: "Dashboard", icon: "dashboard", section: "Overview" },
  { href: "/clients", label: "Clients", icon: "clients", module: "clients", section: "Sales" },
  { href: "/projects", label: "Projects", icon: "projects", module: "projects", section: "Sales" },
  { href: "/pos", label: "Purchase Orders", icon: "pos", module: "pos", section: "Finance" },
  { href: "/invoices", label: "Invoices", icon: "invoices", module: "invoices", section: "Finance" },
  { href: "/reports", label: "Reports", icon: "reports", module: "reports", section: "Finance" },
  { href: "/settings", label: "Settings", icon: "settings", module: "settings", section: "Admin" },
  { href: "/users", label: "Users", icon: "users", module: "users", section: "Admin" },
  { href: "/audit", label: "Audit Log", icon: "audit", module: "audit", section: "Admin" },
];

function Logo({ dark }: { dark?: boolean }) {
  return (
    <span className="flex items-center gap-2.5">
      <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-brand-400 to-brand-700 text-[13px] font-bold text-white shadow-md shadow-brand-600/30">IC</span>
      <span className={dark ? "text-[15px] font-semibold tracking-tight text-white" : "text-[15px] font-semibold tracking-tight text-slate-900"}>
        Invoice<span className="text-brand-500"> + </span>CRM
      </span>
    </span>
  );
}

function BellLink({ count }: { count: number }) {
  return (
    <Link href="/notifications" aria-label={`Notifications${count ? ` (${count} unread)` : ""}`}
      className="relative inline-flex h-10 w-10 items-center justify-center rounded-xl text-slate-500 transition hover:bg-slate-100 hover:text-slate-900">
      <Bell className="h-5 w-5" aria-hidden />
      {count > 0 && (
        <span className="absolute right-1.5 top-1.5 min-w-[18px] rounded-full bg-rose-500 px-1 text-center text-[10px] font-semibold leading-[18px] text-white ring-2 ring-white">
          {count > 99 ? "99+" : count}
        </span>
      )}
    </Link>
  );
}

function SearchBox() {
  return (
    <form action="/search" role="search" className="relative w-full max-w-md">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
      <input name="q" placeholder="Search clients, projects, POs, invoices…" aria-label="Search clients, projects, POs, invoices"
        className="h-10 w-full rounded-xl border border-slate-200 bg-slate-50 pl-9 pr-3 text-sm text-slate-900 placeholder:text-slate-400 transition focus:border-brand-400 focus:bg-white focus:outline-none focus:ring-4 focus:ring-brand-500/15" />
    </form>
  );
}

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join("") || "?";
}

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const user = await requireUser();
  const links: NavItem[] = NAV
    .filter((n) => !n.module || can(user.role, n.module, n.module === "settings" || n.module === "users" ? "administer" : "view"))
    .map(({ href, label, icon, section }) => ({ href, label, icon, section }));
  const unread = await prisma.notification.count({ where: { userId: user.id, readAt: null } });
  after(() => maybeScan(prisma)); // due/overdue notifications, throttled; also available via /api/cron/notifications
  const mfaNag = (user.role === "ADMIN" || user.role === "FINANCE") && !user.mfaEnabled;

  return (
    <div className="flex min-h-screen bg-slate-50">
      {/* Sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-brand-100 bg-gradient-to-b from-brand-50 to-sky-50 md:flex print:hidden">
        <div className="flex h-16 items-center px-6"><Link href="/" aria-label="Dashboard"><Logo /></Link></div>
        <div className="sidebar-scroll flex-1 overflow-y-auto pb-4 pt-2"><NavLinks links={links} /></div>
        <div className="border-t border-brand-100 p-3">
          <Link href="/account" className="flex items-center gap-3 rounded-xl px-3 py-2.5 transition hover:bg-white/70">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-600 text-sm font-semibold text-white ring-2 ring-white">
              {initials(user.name)}
            </span>
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium text-slate-900">{user.name}</span>
              <span className="block truncate text-xs text-slate-500">{ROLE_LABELS[user.role]}</span>
            </span>
          </Link>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col md:pl-64">
        {/* Top bar */}
        <header className="sticky top-0 z-20 border-b border-slate-200/80 bg-white/85 backdrop-blur print:hidden">
          <div className="flex h-16 items-center gap-4 px-4 md:px-8">
            <span className="md:hidden"><Link href="/" aria-label="Dashboard"><Logo /></Link></span>
            <span className="hidden min-w-[120px] md:block"><CurrentSection links={links} /></span>
            <div className="flex flex-1 justify-center"><SearchBox /></div>
            <BellLink count={unread} />
            <details className="relative">
              <summary className="flex cursor-pointer items-center gap-2 rounded-xl py-1 pl-1 pr-2 transition hover:bg-slate-100" aria-label="Account menu">
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-600 text-xs font-semibold text-white">{initials(user.name)}</span>
                <ChevronDown className="hidden h-4 w-4 text-slate-400 sm:block" aria-hidden />
              </summary>
              <div className="absolute right-0 mt-2 w-60 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl shadow-slate-900/10">
                <div className="border-b border-slate-100 px-4 py-3">
                  <div className="truncate text-sm font-semibold text-slate-900">{user.name}</div>
                  <div className="truncate text-xs text-slate-500">{user.email}</div>
                </div>
                <Link href="/account" className="flex items-center gap-2 px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50">
                  <UserRound className="h-4 w-4 text-slate-400" aria-hidden />My account
                </Link>
                <form action={logout}>
                  <button className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm text-slate-700 hover:bg-slate-50">
                    <LogOut className="h-4 w-4 text-slate-400" aria-hidden />Sign out
                  </button>
                </form>
              </div>
            </details>
          </div>
          <div className="border-t border-slate-100 md:hidden"><MobileNav links={links} /></div>
        </header>

        {mfaNag && (
          <div className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900 md:px-8 print:hidden">
            <span className="inline-flex items-center gap-2">
              <ShieldAlert className="h-4 w-4" aria-hidden />
              Two-factor authentication is off for your {ROLE_LABELS[user.role]} account.
              <Link href="/account" className="font-semibold underline underline-offset-2">Turn it on</Link>
            </span>
          </div>
        )}

        <main className="mx-auto w-full max-w-[1400px] flex-1 px-4 py-8 md:px-8">{children}</main>
      </div>
    </div>
  );
}
