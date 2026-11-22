"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3, Building2, FileText, FolderKanban, LayoutDashboard, ReceiptText, ScrollText, Settings, Users, type LucideIcon,
} from "lucide-react";
import { cx } from "@/components/ui";

export const NAV_ICONS = {
  dashboard: LayoutDashboard, clients: Building2, projects: FolderKanban, pos: FileText, invoices: ReceiptText,
  reports: BarChart3, settings: Settings, users: Users, audit: ScrollText,
} satisfies Record<string, LucideIcon>;
export type NavIcon = keyof typeof NAV_ICONS;
export interface NavItem { href: string; label: string; icon: NavIcon; section?: string }

function isActive(path: string, href: string) {
  return href === "/" ? path === "/" : path === href || path.startsWith(href + "/");
}

/** Dark sidebar navigation, grouped by section. */
export function NavLinks({ links }: { links: NavItem[] }) {
  const path = usePathname();
  const sections = [...new Set(links.map((l) => l.section ?? ""))];
  return (
    <nav className="flex flex-col gap-6 px-3" aria-label="Main">
      {sections.map((s) => (
        <div key={s}>
          {s && <div className="mb-2 px-3 text-[11px] font-semibold uppercase tracking-wider text-brand-700/60">{s}</div>}
          <ul className="space-y-0.5">
            {links.filter((l) => (l.section ?? "") === s).map((l) => {
              const Icon = NAV_ICONS[l.icon];
              const active = isActive(path, l.href);
              return (
                <li key={l.href}>
                  <Link href={l.href} aria-current={active ? "page" : undefined}
                    className={cx("group relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition",
                      active ? "bg-white text-brand-700 shadow-sm shadow-brand-900/5 ring-1 ring-brand-200" : "text-slate-600 hover:bg-white/70 hover:text-brand-700")}>
                    {active && <span className="absolute inset-y-1.5 left-0 w-[3px] rounded-r-full bg-brand-600" aria-hidden />}
                    <Icon className={cx("h-[18px] w-[18px] shrink-0", active ? "text-brand-600" : "text-slate-400 group-hover:text-brand-600")} aria-hidden />
                    {l.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

/** Compact horizontal nav for small screens. */
export function MobileNav({ links }: { links: NavItem[] }) {
  const path = usePathname();
  return (
    <nav className="flex gap-1 overflow-x-auto px-3 py-2" aria-label="Main">
      {links.map((l) => {
        const Icon = NAV_ICONS[l.icon];
        const active = isActive(path, l.href);
        return (
          <Link key={l.href} href={l.href} aria-current={active ? "page" : undefined}
            className={cx("flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium whitespace-nowrap",
              active ? "bg-brand-50 text-brand-700" : "text-slate-600 hover:bg-slate-100")}>
            <Icon className="h-4 w-4" aria-hidden />{l.label}
          </Link>
        );
      })}
    </nav>
  );
}

/** Title of the current section for the top bar. */
export function CurrentSection({ links }: { links: NavItem[] }) {
  const path = usePathname();
  const match = [...links].sort((a, b) => b.href.length - a.href.length).find((l) => isActive(path, l.href));
  const extra: Record<string, string> = { "/account": "My account", "/notifications": "Notifications", "/search": "Search" };
  const label = match?.label ?? Object.entries(extra).find(([k]) => path.startsWith(k))?.[1] ?? "";
  return <span className="truncate text-sm font-medium text-slate-500">{label}</span>;
}
