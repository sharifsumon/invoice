"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cx } from "@/components/ui";

export function NavLinks({ links, horizontal }: { links: { href: string; label: string }[]; horizontal?: boolean }) {
  const path = usePathname();
  return (
    <nav className={cx(horizontal ? "flex gap-1 overflow-x-auto py-2" : "flex flex-col gap-0.5 px-3")}>
      {links.map((l) => {
        const active = l.href === "/" ? path === "/" : path.startsWith(l.href);
        return (
          <Link key={l.href} href={l.href}
            className={cx("rounded-lg px-3 py-2 text-sm whitespace-nowrap",
              active ? "bg-indigo-50 font-medium text-indigo-700" : "text-slate-600 hover:bg-slate-100 hover:text-slate-900")}>
            {l.label}
          </Link>
        );
      })}
    </nav>
  );
}
