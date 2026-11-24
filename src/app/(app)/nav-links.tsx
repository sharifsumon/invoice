"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3, Building2, FileText, FolderKanban, LayoutDashboard, ReceiptText, ScrollText, Settings, ShieldCheck, Users, type LucideIcon,
} from "lucide-react";
import { cx } from "@/components/ui";

export const NAV_ICONS = {
  dashboard: LayoutDashboard, clients: Building2, projects: FolderKanban, pos: FileText, invoices: ReceiptText,
  reports: BarChart3, settings: Settings, users: Users, groups: ShieldCheck, audit: ScrollText,
} satisfies Record<string, LucideIcon>;
export type NavIcon = keyof typeof NAV_ICONS;
export interface NavItem { href: string; label: string; icon: NavIcon; section?: string }

function matches(path: string, href: string) {
  return href === "/" ? path === "/" : path === href || path.startsWith(href + "/");
}

/** The most specific nav item for the path (so /users/groups highlights "User groups", not "Users"). */
function activeHref(path: string, links: NavItem[]) {
  return [...links].sort((a, b) => b.href.length - a.href.length).find((l) => matches(path, l.href))?.href;
}

/** Sidebar navigation: a flat list, sections separated by a little space. */
export function NavLinks({ links }: { links: NavItem[] }) {
  const path = usePathname();
  const current = activeHref(path, links);
  const sections = [...new Set(links.map((l) => l.section ?? ""))];
  return (
    <nav className="flex flex-col gap-4 px-4" aria-label="Main">
      {sections.map((s) => (
        <ul key={s} className="space-y-1" aria-label={s || undefined}>
          {links.filter((l) => (l.section ?? "") === s).map((l) => {
            const Icon = NAV_ICONS[l.icon];
            const active = l.href === current;
            return (
              <li key={l.href}>
                <Link href={l.href} aria-current={active ? "page" : undefined}
                  className={cx("group flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-[14px] font-medium transition",
                    active ? "bg-brand-500 text-white shadow-sm shadow-brand-600/25" : "text-slate-600 hover:bg-brand-50 hover:text-brand-800")}>
                  <Icon className={cx("h-[18px] w-[18px] shrink-0", active ? "text-white" : "text-slate-400 group-hover:text-brand-600")} strokeWidth={1.8} aria-hidden />
                  {l.label}
                </Link>
              </li>
            );
          })}
        </ul>
      ))}
    </nav>
  );
}

/** Compact horizontal nav for small screens. */
export function MobileNav({ links }: { links: NavItem[] }) {
  const path = usePathname();
  const current = activeHref(path, links);
  return (
    <nav className="flex gap-1 overflow-x-auto px-3 py-2 [scrollbar-width:none]" aria-label="Main">
      {links.map((l) => {
        const Icon = NAV_ICONS[l.icon];
        const active = l.href === current;
        return (
          <Link key={l.href} href={l.href} aria-current={active ? "page" : undefined}
            className={cx("flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium whitespace-nowrap",
              active ? "bg-brand-500 text-white" : "text-slate-600 hover:bg-brand-50")}>
            <Icon className="h-4 w-4" aria-hidden />{l.label}
          </Link>
        );
      })}
    </nav>
  );
}

const EXTRA: Record<string, string> = { "/account": "My account", "/notifications": "Notifications", "/search": "Search" };

/** Section title + breadcrumb for the top bar ("Projects" / Dashboard › Projects). */
export function CurrentSection({ links }: { links: NavItem[] }) {
  const path = usePathname();
  const match = links.find((l) => l.href === activeHref(path, links));
  const label = match?.label ?? Object.entries(EXTRA).find(([k]) => path.startsWith(k))?.[1] ?? "";
  const sectionHref = match?.href ?? path;
  const deeper = path !== sectionHref && path !== "/";
  return (
    <div className="min-w-0">
      <div className="truncate text-[20px] font-semibold leading-tight tracking-tight text-slate-900">{label || "Dashboard"}</div>
      <div className="mt-0.5 flex items-center gap-1.5 truncate text-xs text-slate-500">
        {path === "/" ? <span>Overview</span> : <>
          <Link href="/" className="font-medium text-brand-600 hover:underline">Dashboard</Link>
          <span aria-hidden>/</span>
          {deeper ? <Link href={sectionHref} className="font-medium text-brand-600 hover:underline">{label}</Link> : <span>{label}</span>}
          {deeper && <><span aria-hidden>/</span><span>{path.endsWith("/new") ? "New" : "Details"}</span></>}
        </>}
      </div>
    </div>
  );
}
