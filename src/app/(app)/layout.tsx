import Link from "next/link";
import { after } from "next/server";
import { Bell, ChevronDown, Clock, FilePlus2, LogOut, Search, Settings, ShieldAlert, UserRound } from "lucide-react";
import { currentSubscription, requireUser } from "@/server/auth";
import { PLANS } from "@/lib/plans";
import { APP_NAME, BrandLogo } from "@/components/brand";
import { maybeScan } from "@/server/core/notifications";
import { can, type Action, type Module } from "@/server/core/permissions";
import { getSettings } from "@/server/core/settings";
import { prisma } from "@/server/db";
import { logout } from "../login/actions";
import { CurrentSection, MobileNav, NavLinks, type NavItem } from "./nav-links";

const NAV: (NavItem & { module?: Module; action?: Action })[] = [
  { href: "/dashboard", label: "Dashboard", icon: "dashboard", section: "Overview" },
  { href: "/assistant", label: "AI assistant", icon: "assistant", module: "assistant", section: "Overview" },
  { href: "/clients", label: "Clients", icon: "clients", module: "clients", section: "Sales" },
  { href: "/projects", label: "Projects", icon: "projects", module: "projects", section: "Sales" },
  { href: "/pos", label: "Purchase Orders", icon: "pos", module: "pos", section: "Finance" },
  { href: "/invoices", label: "Invoices", icon: "invoices", module: "invoices", section: "Finance" },
  { href: "/reports", label: "Reports", icon: "reports", module: "reports", section: "Finance" },
  { href: "/settings", label: "Settings", icon: "settings", module: "settings", action: "administer", section: "Admin" },
  { href: "/subscription", label: "Subscription", icon: "subscription", module: "settings", action: "administer", section: "Admin" },
  { href: "/users", label: "Users", icon: "users", module: "users", section: "Admin" },
  { href: "/users/groups", label: "User groups", icon: "groups", module: "users", action: "groups", section: "Admin" },
  { href: "/audit", label: "Audit Log", icon: "audit", module: "audit", section: "Admin" },
];

const Logo = () => <BrandLogo />;

const iconBtn = "relative inline-flex h-10 w-10 items-center justify-center rounded-xl bg-lime-soft text-brand-900 transition hover:bg-lime-mid";

function BellLink({ count }: { count: number }) {
  return (
    <Link href="/notifications" aria-label={`Notifications${count ? ` (${count} unread)` : ""}`} className={iconBtn}>
      <Bell className="h-[18px] w-[18px]" strokeWidth={1.8} aria-hidden />
      {count > 0 && (
        <span className="absolute -right-1 -top-1 min-w-[18px] rounded-full bg-brand-500 px-1 text-center text-[10px] font-semibold leading-[18px] text-white ring-2 ring-surface">
          {count > 99 ? "99+" : count}
        </span>
      )}
    </Link>
  );
}

function SearchBox() {
  return (
    <form action="/search" role="search" className="relative w-full max-w-xs">
      <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" aria-hidden />
      <input name="q" placeholder="Search anything" aria-label="Search clients, projects, POs, invoices"
        className="h-10 w-full rounded-xl border border-transparent bg-white pl-10 pr-3 text-sm text-slate-900 placeholder:text-slate-500 transition focus:border-brand-300 focus:outline-none focus:ring-4 focus:ring-brand-500/15" />
    </form>
  );
}

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join("") || "?";
}

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const user = await requireUser({ allowExpired: true });
  const links: NavItem[] = NAV
    .filter((n) => !n.module || can(user, n.module, n.action ?? "view"))
    .map(({ href, label, icon, section }) => ({ href, label, icon, section }));
  const [unread, { company }, sub] = await Promise.all([
    prisma.notification.count({ where: { userId: user.id, readAt: null } }),
    getSettings(prisma),
    currentSubscription(),
  ]);
  after(() => maybeScan(prisma)); // due/overdue notifications, throttled; also available via /api/cron/notifications
  // Remind anyone holding sensitive rights (finalize invoices, payments, settings, users) to turn on 2FA
  const sensitive = can(user, "invoices", "approve") || can(user, "invoices", "payments") || can(user, "settings", "administer") || can(user, "users", "edit");
  const mfaNag = sensitive && !user.mfaEnabled;
  const canAdmin = can(user, "settings", "administer");

  return (
    <div className="min-h-screen bg-canvas md:p-4">
      <div className="flex min-h-screen bg-white md:min-h-[calc(100vh-2rem)] md:rounded-[28px] md:shadow-[0_1px_3px_rgba(16,40,32,0.06)]">
        {/* Sidebar */}
        <aside className="sticky top-4 hidden h-[calc(100vh-2rem)] w-64 shrink-0 flex-col md:flex print:hidden">
          <div className="flex h-20 items-center px-7"><Link href="/dashboard" aria-label="Dashboard"><Logo /></Link></div>
          <div className="sidebar-scroll flex-1 overflow-y-auto py-2"><NavLinks links={links} /></div>
          {can(user, "pos", "create") && (
            <div className="m-4 rounded-2xl bg-lime-soft p-5">
              <div className="text-[17px] font-semibold leading-snug text-brand-950">Got a new order?</div>
              <p className="mt-1.5 text-xs leading-relaxed text-brand-900/75">Record the PO and its milestones — the invoices are created for you on approval.</p>
              <Link href="/pos/new" className="mt-4 flex h-10 items-center justify-center gap-1.5 rounded-xl bg-brand-500 text-sm font-semibold text-white shadow-sm shadow-brand-600/25 transition hover:bg-brand-600">
                <FilePlus2 className="h-4 w-4" aria-hidden />Record a PO
              </Link>
            </div>
          )}
        </aside>

        {/* Main area */}
        <div className="flex min-w-0 flex-1 flex-col bg-surface md:my-2 md:mr-2 md:rounded-[22px]">
          <header className="sticky top-0 z-20 bg-surface/90 backdrop-blur md:rounded-t-[22px] print:hidden">
            <div className="flex h-20 items-center gap-3 px-4 md:px-8">
              <span className="md:hidden"><Link href="/dashboard" aria-label="Dashboard"><Logo /></Link></span>
              <span className="hidden min-w-0 flex-1 md:block"><CurrentSection links={links} /></span>
              <div className="flex flex-1 justify-end md:flex-none"><SearchBox /></div>
              {canAdmin && <Link href="/settings" aria-label="Settings" className={`${iconBtn} hidden sm:inline-flex`}><Settings className="h-[18px] w-[18px]" strokeWidth={1.8} aria-hidden /></Link>}
              <BellLink count={unread} />
              <details className="relative">
                <summary className="flex cursor-pointer items-center gap-2.5 rounded-xl py-1 pl-1 pr-2 transition hover:bg-white" aria-label="Account menu">
                  <span className="flex h-10 w-10 items-center justify-center rounded-full bg-brand-900 text-sm font-semibold text-white">{initials(user.name)}</span>
                  <span className="hidden text-left lg:block">
                    <span className="block max-w-[140px] truncate text-sm font-semibold leading-tight text-slate-900">{user.name}</span>
                    <span className="block max-w-[140px] truncate text-xs text-slate-500">{user.groupName}</span>
                  </span>
                  <ChevronDown className="hidden h-4 w-4 text-slate-400 sm:block" aria-hidden />
                </summary>
                <div className="absolute right-0 mt-2 w-60 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl shadow-slate-900/10">
                  <div className="border-b border-slate-100 px-4 py-3">
                    <div className="truncate text-sm font-semibold text-slate-900">{user.name}</div>
                    <div className="truncate text-xs text-slate-500">{user.email}</div>
                  </div>
                  <Link href="/account" className="flex items-center gap-2 px-4 py-2.5 text-sm text-slate-700 hover:bg-brand-50">
                    <UserRound className="h-4 w-4 text-slate-400" aria-hidden />My account
                  </Link>
                  <form action={logout}>
                    <button className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm text-slate-700 hover:bg-brand-50">
                      <LogOut className="h-4 w-4 text-slate-400" aria-hidden />Sign out
                    </button>
                  </form>
                </div>
              </details>
            </div>
            <div className="md:hidden"><MobileNav links={links} /></div>
          </header>

          {/* Everyone on the free package sees how long is left and the upgrade options */}
          {sub.status === "trial" && (
            <div role="region" aria-label="Upgrade" className="mx-4 mb-2 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-brand-900 px-4 py-2.5 text-sm text-white md:mx-8 print:hidden">
              <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
                <Clock className="h-4 w-4 text-brand-300" aria-hidden />
                <span>Free package: <b>{sub.trialDaysLeft} day{sub.trialDaysLeft === 1 ? "" : "s"} left</b> · {sub.activeUsers} of {sub.userLimit} users.</span>
                <span className="text-brand-100/80">Upgrade to keep going after {sub.trialEndsAt.toISOString().slice(0, 10)}.</span>
              </span>
              <span className="flex flex-wrap gap-2">
                {PLANS.map((p) => (
                  <Link key={p.id} href="/subscription"
                    className={p.highlight ? "rounded-lg bg-white px-3 py-1 text-xs font-semibold text-brand-900 hover:bg-brand-50" : "rounded-lg bg-white/10 px-3 py-1 text-xs font-semibold text-white ring-1 ring-white/30 hover:bg-white/20"}>
                    Upgrade to {p.name} · ${p.priceUsd}/mo
                  </Link>
                ))}
              </span>
            </div>
          )}

          {mfaNag && (
            <div className="mx-4 mb-2 rounded-xl bg-lime-soft px-4 py-2.5 text-sm text-brand-950 md:mx-8 print:hidden">
              <span className="inline-flex flex-wrap items-center gap-2">
                <ShieldAlert className="h-4 w-4 text-brand-700" aria-hidden />
                Two-factor authentication is off for your account ({user.groupName}).
                <Link href="/account" className="font-semibold text-brand-700 underline underline-offset-2">Turn it on</Link>
              </span>
            </div>
          )}

          <main className="w-full max-w-[1500px] flex-1 px-4 pb-8 pt-4 md:px-8">{children}</main>

          <footer className="flex flex-wrap items-center justify-between gap-3 px-4 pb-6 text-xs text-slate-500 md:px-8 print:hidden">
            <span><span className="font-semibold text-slate-700">© {new Date().getFullYear()} {company.displayName || APP_NAME}</span> · All amounts in {company.defaultCurrency}</span>
            <span className="flex gap-5">
              <Link href="/reports" className="hover:text-brand-700">Reports</Link>
              <Link href="/account" className="hover:text-brand-700">My account</Link>
              <Link href="/notifications" className="hover:text-brand-700">Notifications</Link>
            </span>
          </footer>
        </div>
      </div>
    </div>
  );
}
