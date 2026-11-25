import Link from "next/link";
import type { ReactNode } from "react";
import { TRIAL_DAYS } from "@/lib/plans";
import { buttonClass, cx } from "./ui";
import { APP_NAME, BrandLogo } from "./brand";

export function Logo({ light }: { light?: boolean }) {
  return <BrandLogo light={light} />;
}

/** Public header: shows "Open dashboard" to signed-in users, sign-in / trial buttons to visitors. */
export function MarketingHeader({ signedIn }: { signedIn: boolean }) {
  return (
    <header className="sticky top-0 z-30 border-b border-slate-200/70 bg-white/85 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-6 px-5">
        <Link href="/" aria-label={`${APP_NAME} home`}><Logo /></Link>
        <nav className="hidden items-center gap-6 text-sm font-medium text-slate-600 md:flex" aria-label="Site">
          <Link href="/#assistant" className="hover:text-brand-700">AI assistant</Link>
          <Link href="/#features" className="hover:text-brand-700">Features</Link>
          <Link href="/#how" className="hover:text-brand-700">How it works</Link>
          <Link href="/pricing" className="hover:text-brand-700">Pricing</Link>
        </nav>
        <div className="ml-auto flex items-center gap-2">
          {signedIn
            ? <Link href="/dashboard" className={cx(buttonClass("primary"), "whitespace-nowrap")}>Open dashboard</Link>
            : <>
                {/* wrapper hides it on phones (the button's own inline-flex would override `hidden`) */}
                <span className="hidden sm:block"><Link href="/login" className={cx(buttonClass("ghost"), "whitespace-nowrap")}>Sign in</Link></span>
                <Link href="/login" className={cx(buttonClass("primary"), "whitespace-nowrap")}>Start free trial</Link>
              </>}
        </div>
      </div>
    </header>
  );
}

export function MarketingFooter() {
  return (
    <footer className="bg-brand-950 text-brand-100/80">
      <div className="mx-auto grid max-w-6xl gap-8 px-5 py-12 md:grid-cols-[1.5fr_1fr_1fr]">
        <div>
          <Logo light />
          <p className="mt-3 max-w-sm text-sm">Clients, projects, purchase orders, invoices and payments in one place — with an AI assistant that answers questions about all of it.</p>
        </div>
        <div className="text-sm">
          <div className="font-semibold text-white">Product</div>
          <ul className="mt-3 space-y-2">
            <li><Link href="/#assistant" className="hover:text-white">AI assistant</Link></li>
            <li><Link href="/#features" className="hover:text-white">Features</Link></li>
            <li><Link href="/pricing" className="hover:text-white">Pricing</Link></li>
          </ul>
        </div>
        <div className="text-sm">
          <div className="font-semibold text-white">Get started</div>
          <ul className="mt-3 space-y-2">
            <li><Link href="/login" className="hover:text-white">Start the {TRIAL_DAYS}-day free trial</Link></li>
            <li><Link href="/login" className="hover:text-white">Sign in</Link></li>
          </ul>
        </div>
      </div>
      <div className="border-t border-white/10 py-5 text-center text-xs">© {new Date().getFullYear()} {APP_NAME}. Prices in USD.</div>
    </footer>
  );
}

export function SectionTitle({ eyebrow, title, children, center }: { eyebrow: string; title: ReactNode; children?: ReactNode; center?: boolean }) {
  return (
    <div className={cx("max-w-2xl", center && "mx-auto text-center")}>
      <div className="text-xs font-semibold uppercase tracking-[0.18em] text-brand-600">{eyebrow}</div>
      <h2 className="mt-2 text-3xl font-bold tracking-tight text-brand-950 md:text-[38px] md:leading-[1.15]">{title}</h2>
      {children && <p className="mt-3 text-[16px] leading-relaxed text-slate-600">{children}</p>}
    </div>
  );
}
