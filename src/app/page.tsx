import Link from "next/link";
import {
  ArrowRight, Bell, Building2, Check, FileSpreadsheet, FileText, FileType2, FolderKanban, Mail, MessageSquareText,
  ReceiptText, Search, Sparkles, Wallet, Zap,
} from "lucide-react";
import { getUser } from "@/server/auth";
import { PLANS, TRIAL_DAYS, TRIAL_USER_LIMIT } from "@/lib/plans";
import { PlanCards } from "@/components/plan-cards";
import { MarketingFooter, MarketingHeader, SectionTitle } from "@/components/marketing";
import { buttonClass, cx } from "@/components/ui";

export const metadata = {
  title: "Invoice+CRM — run clients, POs, invoices & payments by chatting with AI",
  description: "Clients, projects, purchase orders, automatic invoices and payments in one place — and an AI assistant that does anything you ask. Free for 14 days.",
};

/** The nine features shown as cards (the AI assistant gets its own large card above them). */
const FEATURES = [
  { icon: Building2, title: "Clients & contacts", text: "One register for every client and contact, with status, country and a timeline of every call, meeting and note." },
  { icon: FolderKanban, title: "Projects", text: "Auto-numbered projects with a simple status flow, approvals and the business value they bring in." },
  { icon: FileText, title: "Purchase orders & milestones", text: "Record a PO and split it into payment milestones — 50/50, 30/40/30, whatever the deal says." },
  { icon: Zap, title: "Automatic invoice creation", text: "Invoices are created for you from each milestone, ready to approve — and never more than the PO is worth." },
  { icon: Wallet, title: "Payments & part payments", text: "Record full or part payments with receipts. The unpaid balance moves to a new invoice in one click." },
  { icon: FileSpreadsheet, title: "Excel & PDF invoices", text: "Branded, numbered PDF invoices with your logo and bank details — and Excel exports of any invoice list." },
  { icon: Mail, title: "Invoice email", text: "Send the invoice PDF straight from the app with a ready template. Every email is kept in the history." },
  { icon: Bell, title: "Notifications", text: "Get told when invoices are due soon or overdue, when POs are approved and if an email fails." },
  { icon: Search, title: "Global search", text: "Find any client, contact, project, PO or invoice in seconds from one search box." },
];

const ASK = [
  "Which invoices are overdue right now?",
  "Show PO ACME-PO-1001 with milestones and payments",
  "Compare invoiced vs collected by month this year",
  "Top 5 clients by outstanding — export to Excel",
];

const STEPS = [
  { n: 1, title: "Add the client", text: "Company details and the primary contact." },
  { n: 2, title: "Create the project", text: "Code is numbered for you; set the value." },
  { n: 3, title: "Record the PO", text: "Add milestones — invoices are created automatically." },
  { n: 4, title: "Approve & send", text: "Approve the PO, finalize invoices, email the PDF." },
  { n: 5, title: "Get paid", text: "Record payments; part-paid balances carry forward." },
];

const FAQ = [
  { q: "How does the free package work?", a: `You get ${TRIAL_DAYS} days with every feature, including the AI assistant, for up to ${TRIAL_USER_LIMIT} users. No card needed. Upgrade to Starter or Team whenever you're ready.` },
  { q: "What's the difference between Starter and Team?", a: `Only the number of users: Starter covers up to ${PLANS[0].userLimit} users for $${PLANS[0].priceUsd} USD a month, Team up to ${PLANS[1].userLimit} for $${PLANS[1].priceUsd} USD a month. Every feature is in both.` },
  { q: "What can the AI assistant do?", a: "Answer questions about your clients, projects, POs, invoices and payments, find any record in detail, compare periods, build custom reports and export them to Excel, Word or PDF. It uses your own Google Gemini key and only shows what each user is allowed to see." },
  { q: "Is my data safe?", a: "Records are never hard-deleted, every change is recorded in an audit log, users can turn on two-factor sign-in, and the AI key is stored encrypted." },
];

export default async function HomePage() {
  const signedIn = !!(await getUser());
  const cta = signedIn ? { href: "/dashboard", label: "Open dashboard" } : { href: "/login", label: `Start free — ${TRIAL_DAYS} days` };

  return (
    <div className="min-h-screen bg-white">
      <MarketingHeader signedIn={signedIn} />

      {/* ── Hero ── */}
      <section className="relative isolate overflow-hidden bg-brand-950 text-white">
        {/* glow + grid backdrop */}
        <div aria-hidden className="pointer-events-none absolute -top-40 left-1/2 -z-10 h-[520px] w-[900px] -translate-x-1/2 rounded-full bg-brand-500/30 blur-3xl" />
        <div aria-hidden className="pointer-events-none absolute -bottom-40 -right-20 -z-10 h-[380px] w-[380px] rounded-full bg-lime-mid/20 blur-3xl" />
        <div aria-hidden className="pointer-events-none absolute -left-24 top-40 -z-10 h-[300px] w-[300px] rounded-full bg-brand-400/20 blur-3xl" />
        <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 opacity-[0.07] [background-image:linear-gradient(to_right,white_1px,transparent_1px),linear-gradient(to_bottom,white_1px,transparent_1px)] [background-size:56px_56px] [mask-image:radial-gradient(ellipse_at_center,black_40%,transparent_75%)]" />

        <div className="mx-auto max-w-5xl px-5 pb-20 pt-20 text-center md:pb-28 md:pt-28">
          <Link href="/#assistant" className="inline-flex items-center gap-2 rounded-full bg-white/10 px-4 py-1.5 text-xs font-semibold text-lime-mid ring-1 ring-white/15 backdrop-blur transition hover:bg-white/15">
            <Sparkles className="h-3.5 w-3.5" aria-hidden />New · Ask the AI assistant anything<ArrowRight className="h-3.5 w-3.5" aria-hidden />
          </Link>
          <h1 className="mx-auto mt-7 max-w-4xl text-[44px] font-bold leading-[1.04] tracking-tight md:text-[72px]">
            From first call to final payment —{" "}
            <span className="bg-gradient-to-r from-lime-mid via-brand-300 to-brand-400 bg-clip-text text-transparent">just ask.</span>
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-brand-100/80 md:text-xl">
            Clients, projects, purchase orders, automatic invoices and payments in one simple app — with an AI assistant that finds,
            compares and exports anything you need in seconds.
          </p>
          <div className="mt-10 flex flex-wrap justify-center gap-3">
            <Link href={cta.href} className="inline-flex h-13 items-center gap-2 rounded-2xl bg-lime-mid px-7 py-3.5 text-[16px] font-semibold text-brand-950 shadow-lg shadow-lime-mid/20 transition hover:-translate-y-0.5 hover:bg-lime-soft">
              {cta.label}<ArrowRight className="h-4 w-4" aria-hidden />
            </Link>
            <Link href="/pricing" className="inline-flex h-13 items-center gap-2 rounded-2xl bg-white/10 px-7 py-3.5 text-[16px] font-semibold text-white ring-1 ring-white/20 transition hover:bg-white/15">
              See pricing
            </Link>
          </div>
          <ul className="mt-6 flex flex-wrap justify-center gap-x-6 gap-y-2 text-sm text-brand-100/75">
            {[`Free for ${TRIAL_DAYS} days`, "No card needed", `Paid plans from $${PLANS[0].priceUsd}/month`].map((t) => (
              <li key={t} className="inline-flex items-center gap-1.5"><Check className="h-4 w-4 text-lime-mid" aria-hidden />{t}</li>
            ))}
          </ul>

          {/* feature chips */}
          <ul className="mx-auto mt-14 flex max-w-4xl flex-wrap justify-center gap-2.5" aria-label="Features">
            {[{ icon: Sparkles, title: "AI assistant" }, ...FEATURES].map(({ icon: Icon, title }) => (
              <li key={title} className="inline-flex items-center gap-2 rounded-full bg-white/[0.06] px-3.5 py-2 text-[13px] font-medium text-white/90 ring-1 ring-white/10">
                <Icon className="h-4 w-4 text-brand-300" aria-hidden />{title}
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* ── Stats band ── */}
      <section className="border-b border-slate-100 bg-white">
        <dl className="mx-auto grid max-w-5xl grid-cols-2 gap-6 px-5 py-10 text-center md:grid-cols-4">
          {[
            { k: `${TRIAL_DAYS} days`, v: "free to try everything" },
            { k: "10", v: "features in every package" },
            { k: "0", v: "invoices typed by hand" },
            { k: `$${PLANS[0].priceUsd}`, v: "per month after that" },
          ].map(({ k, v }) => (
            <div key={v}>
              <dt className="text-3xl font-bold tracking-tight text-brand-600 md:text-4xl">{k}</dt>
              <dd className="mt-1 text-sm text-slate-500">{v}</dd>
            </div>
          ))}
        </dl>
      </section>

      {/* ── Features ── */}
      <section id="features" className="scroll-mt-20 bg-gradient-to-b from-white via-brand-50/40 to-white">
        <div className="mx-auto max-w-6xl px-5 py-24">
          <SectionTitle eyebrow="Features" title="Everything you need to get paid — in one place" center>
            Ten features, all included in every package. No add-ons, no surprises.
          </SectionTitle>

          {/* AI assistant — the headline feature */}
          <div id="assistant" className="relative mt-14 scroll-mt-24 overflow-hidden rounded-[32px] bg-gradient-to-br from-brand-900 via-brand-950 to-brand-950 p-8 text-white shadow-2xl shadow-brand-950/20 md:p-12">
            <div aria-hidden className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-brand-500/30 blur-3xl" />
            <div aria-hidden className="pointer-events-none absolute -bottom-28 left-1/3 h-64 w-64 rounded-full bg-lime-mid/15 blur-3xl" />
            <div className="relative grid gap-10 lg:grid-cols-2 lg:items-center">
              <div>
                <span className="inline-flex items-center gap-2 rounded-full bg-lime-mid px-3 py-1 text-xs font-bold uppercase tracking-wide text-brand-950">
                  <Sparkles className="h-3.5 w-3.5" aria-hidden />AI assistant
                </span>
                <h3 className="mt-5 text-3xl font-bold leading-tight tracking-tight md:text-[40px]">Ask the AI assistant anything</h3>
                <p className="mt-4 text-[16px] leading-relaxed text-brand-100/80">
                  Ask in everyday language. The assistant reads your clients, projects, POs, invoices and payments, does the calculations for you,
                  and hands back a clear answer — or a ready-made report.
                </p>
                <ul className="mt-6 grid gap-3 sm:grid-cols-2">
                  {["Find any PO or invoice in detail", "Compare months, clients or projects", "Build custom reports on the spot", "Export to Excel, Word or PDF"].map((t) => (
                    <li key={t} className="flex items-start gap-2.5 text-[15px]"><Check className="mt-0.5 h-4 w-4 shrink-0 text-lime-mid" aria-hidden />{t}</li>
                  ))}
                </ul>
                <div className="mt-7 flex flex-wrap gap-2">
                  {[{ i: FileSpreadsheet, l: "Excel" }, { i: FileType2, l: "Word" }, { i: FileText, l: "PDF" }].map(({ i: Icon, l }) => (
                    <span key={l} className="inline-flex items-center gap-1.5 rounded-lg bg-white/10 px-3 py-1.5 text-xs font-medium ring-1 ring-white/10"><Icon className="h-3.5 w-3.5 text-brand-300" aria-hidden />{l}</span>
                  ))}
                </div>
              </div>
              <div>
                <div className="text-sm font-semibold text-brand-200">Try asking…</div>
                <ul className="mt-3 space-y-3">
                  {ASK.map((q) => (
                    <li key={q} className="flex items-center gap-3 rounded-2xl bg-white/[0.07] px-4 py-4 text-[15px] ring-1 ring-white/10 backdrop-blur">
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-500/30"><MessageSquareText className="h-4 w-4 text-lime-mid" aria-hidden /></span>
                      {q}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>

          {/* The other nine */}
          <div className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map(({ icon: Icon, title, text }) => (
              <div key={title} className="group relative overflow-hidden rounded-[24px] bg-white p-7 ring-1 ring-slate-200/80 transition duration-200 hover:-translate-y-1 hover:shadow-xl hover:shadow-brand-900/10 hover:ring-brand-200">
                <div aria-hidden className="pointer-events-none absolute -right-10 -top-10 h-28 w-28 rounded-full bg-lime-soft opacity-0 blur-2xl transition group-hover:opacity-100" />
                <span className="relative flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-400 to-brand-600 text-white shadow-md shadow-brand-600/25">
                  <Icon className="h-5 w-5" aria-hidden />
                </span>
                <h3 className="relative mt-5 text-[18px] font-semibold text-slate-900">{title}</h3>
                <p className="relative mt-2 text-[15px] leading-relaxed text-slate-600">{text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── How it works ── */}
      <section id="how" className="scroll-mt-20 bg-surface">
        <div className="mx-auto max-w-6xl px-5 py-24">
          <SectionTitle eyebrow="How it works" title="One flow, from client to cash" center />
          <ol className="mt-12 grid gap-4 md:grid-cols-5">
            {STEPS.map((s, i) => (
              <li key={s.n} className="relative rounded-[22px] bg-white p-6 ring-1 ring-slate-200/70">
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-500 text-sm font-bold text-white">{s.n}</span>
                {i < STEPS.length - 1 && <ArrowRight className="absolute -right-3 top-9 z-10 hidden h-5 w-5 text-brand-300 md:block" aria-hidden />}
                <div className="mt-4 font-semibold text-slate-900">{s.title}</div>
                <p className="mt-1 text-sm text-slate-600">{s.text}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* ── Pricing ── */}
      <section id="pricing" className="scroll-mt-20">
        <div className="mx-auto max-w-6xl px-5 py-24">
          <SectionTitle eyebrow="Pricing" title="Simple pricing for every team" center>
            Start free for {TRIAL_DAYS} days, or go straight to a paid plan. Simple monthly pricing in USD.
          </SectionTitle>
          <div className="mt-12">
            <PlanCards
              trialAction={<Link href={signedIn ? "/subscription" : "/login"} className={cx(buttonClass("secondary"), "w-full")}>{signedIn ? "View subscription" : "Start free trial"}</Link>}
              action={(p) => (
                <Link href={signedIn ? "/subscription" : "/login"} className={cx(buttonClass(p.highlight ? "primary" : "secondary"), "w-full")}>
                  Choose {p.name}
                </Link>
              )} />
          </div>
        </div>
      </section>

      {/* ── FAQ ── */}
      <section className="bg-surface">
        <div className="mx-auto max-w-3xl px-5 py-24">
          <SectionTitle eyebrow="Questions" title="Good to know" center />
          <div className="mt-10 space-y-3">
            {FAQ.map((f) => (
              <details key={f.q} className="group rounded-2xl bg-white px-5 py-4 ring-1 ring-slate-200/70">
                <summary className="flex items-center justify-between gap-4 font-semibold text-slate-900">
                  {f.q}<span className="text-xl text-brand-500 transition group-open:rotate-45" aria-hidden>+</span>
                </summary>
                <p className="mt-2 text-sm leading-relaxed text-slate-600">{f.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* ── Final CTA ── */}
      <section className="mx-auto max-w-6xl px-5 py-24">
        <div className="relative isolate overflow-hidden rounded-[32px] bg-gradient-to-br from-brand-500 to-brand-700 px-8 py-14 text-center text-white md:px-16">
          <div aria-hidden className="pointer-events-none absolute -left-20 -top-20 -z-10 h-64 w-64 rounded-full bg-lime-mid/30 blur-3xl" />
          <div aria-hidden className="pointer-events-none absolute -bottom-24 -right-16 -z-10 h-72 w-72 rounded-full bg-brand-950/40 blur-3xl" />
          <ReceiptText className="mx-auto h-10 w-10 text-lime-mid" aria-hidden />
          <h2 className="mx-auto mt-4 max-w-2xl text-3xl font-bold tracking-tight md:text-[40px] md:leading-tight">Stop chasing paperwork. Start getting paid.</h2>
          <p className="mx-auto mt-3 max-w-xl text-white/85">Free for {TRIAL_DAYS} days, every feature, up to {TRIAL_USER_LIMIT} users. No card needed.</p>
          <Link href={cta.href} className="mt-8 inline-flex items-center gap-2 rounded-2xl bg-white px-7 py-3.5 text-[16px] font-semibold text-brand-800 shadow-lg transition hover:-translate-y-0.5 hover:bg-brand-50">
            {cta.label}<ArrowRight className="h-4 w-4" aria-hidden />
          </Link>
        </div>
      </section>

      <MarketingFooter />
    </div>
  );
}
