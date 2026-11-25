import Link from "next/link";
import {
  ArrowRight, BarChart3, Bell, Building2, Check, CreditCard, FileSpreadsheet, FileText, FileType2, FolderKanban, KeyRound,
  Mail, ReceiptText, ScrollText, Search, ShieldCheck, Sparkles, Split, Users, Wallet,
} from "lucide-react";
import { getUser } from "@/server/auth";
import { TRIAL_DAYS } from "@/lib/plans";
import { PlanCards } from "@/components/plan-cards";
import { MarketingFooter, MarketingHeader, SectionTitle } from "@/components/marketing";
import { buttonClass, cx } from "@/components/ui";

export const metadata = {
  title: "Invoice+CRM — CRM, purchase orders, invoicing & an AI assistant",
  description: "Manage clients, projects, purchase orders, invoices and payments in one place, and ask an AI assistant anything about your data. 14-day free trial.",
};

const FEATURES = [
  { icon: Building2, title: "Clients & contacts", text: "Client register with primary contacts, status, countries and a full activity timeline of calls, meetings and notes." },
  { icon: FolderKanban, title: "Projects", text: "Auto-numbered project codes, a status dropdown (Draft → In progress → Completed), approvals and business value." },
  { icon: FileText, title: "Purchase orders & milestones", text: "Record a PO with payment milestones that must total 100%. Approval workflow with Save draft and Approve." },
  { icon: ReceiptText, title: "Automatic invoices", text: "Milestone invoices are drafted for you when a PO is recorded, released on approval, and never exceed the PO value." },
  { icon: Wallet, title: "Payments & part payments", text: "Record full or partial payments with receipts. Carry an unpaid balance to a new invoice in one click; reverse with a reason." },
  { icon: FileText, title: "PDF invoices", text: "Numbered, branded PDF invoices with your logo and bank details, showing payments received and the balance due." },
  { icon: Mail, title: "Invoice email", text: "Email the invoice PDF from a template with merge fields. Every send and failure is kept in the history." },
  { icon: BarChart3, title: "10 built-in reports", text: "Receivables aging, collections, forecasts, client and project performance — export to CSV, Excel or PDF." },
  { icon: Users, title: "User groups & permissions", text: "Create groups and tick exactly what each can view, create, edit, delete, approve, export or pay." },
  { icon: ShieldCheck, title: "Security & audit", text: "Two-factor sign-in, sessions you can revoke, encrypted secrets and an append-only audit log of every change." },
  { icon: Bell, title: "Notifications", text: "Due-soon and overdue invoice alerts, PO approvals and email failures, sent to the groups you choose." },
  { icon: Search, title: "Global search", text: "Find any client, contact, project, PO or invoice from one search box — filtered by each user's permissions." },
];

const STEPS = [
  { n: 1, title: "Add the client", text: "Company details and the primary contact." },
  { n: 2, title: "Create the project", text: "Code is numbered for you; set the value." },
  { n: 3, title: "Record the PO", text: "Add milestones — invoices are drafted automatically." },
  { n: 4, title: "Approve & finalize", text: "Approve the PO, finalize invoices, email the PDF." },
  { n: 5, title: "Get paid", text: "Record payments; part-paid balances carry forward." },
];

const QUESTIONS = [
  "Which invoices are overdue right now?",
  "Compare invoiced vs collected by month this year",
  "Show the milestones and payments on PO ACME-PO-1001",
  "Top 5 clients by outstanding balance — export to Excel",
];

const FAQ = [
  { q: "How does the free trial work?", a: `Every new workspace gets ${TRIAL_DAYS} days with every feature, including the AI assistant, for up to 10 users. No card needed. Choose a plan any time before it ends.` },
  { q: "What's the difference between the plans?", a: "Only the number of users: Starter covers up to 5 active users for $10 USD a month, Team up to 10 for $20 USD a month. Every feature is in both." },
  { q: "What does the AI assistant need?", a: "A Google Gemini API key (from Google AI Studio), added once in Settings. It answers from your live data, respects each user's permissions, and can export answers to Excel, Word or PDF." },
  { q: "Is my data safe?", a: "Records are never hard-deleted, every change is in the audit log, users can turn on two-factor sign-in, and the AI key is stored encrypted." },
];

function AssistantMock() {
  return (
    <div className="rounded-[24px] bg-white p-5 shadow-2xl shadow-brand-950/25 ring-1 ring-white/20">
      <div className="flex items-center gap-2 border-b border-slate-100 pb-3 text-sm font-semibold text-slate-900">
        <Sparkles className="h-4 w-4 text-brand-500" aria-hidden />AI assistant
      </div>
      <div className="mt-4 space-y-4 text-[13px]">
        <div className="flex justify-end"><div className="rounded-2xl rounded-br-md bg-brand-500 px-3.5 py-2 text-white">Compare invoiced vs collected by client this year, and export it to Excel</div></div>
        <div className="flex gap-2.5">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-lime-soft"><Sparkles className="h-3.5 w-3.5 text-brand-700" aria-hidden /></span>
          <div className="min-w-0 flex-1 rounded-2xl rounded-tl-md bg-surface px-3.5 py-3 text-slate-700">
            <p>You&apos;ve collected <b>78%</b> of what you invoiced this year. Acme Retail has the largest open balance.</p>
            <table className="mt-2.5 w-full text-left text-[12px]">
              <thead className="text-slate-500"><tr><th className="py-1 font-medium">Client</th><th className="py-1 text-right font-medium">Invoiced</th><th className="py-1 text-right font-medium">Collected</th></tr></thead>
              <tbody className="tabular">
                <tr className="border-t border-slate-200/70"><td className="py-1">Acme Retail</td><td className="py-1 text-right">48,000.00</td><td className="py-1 text-right">33,600.00</td></tr>
                <tr className="border-t border-slate-200/70"><td className="py-1">Nova Health</td><td className="py-1 text-right">22,500.00</td><td className="py-1 text-right">20,000.00</td></tr>
                <tr className="border-t border-slate-200/70"><td className="py-1">Bluewave</td><td className="py-1 text-right">9,800.00</td><td className="py-1 text-right">9,800.00</td></tr>
              </tbody>
            </table>
            <span className="mt-3 inline-flex items-center gap-2 rounded-lg bg-white px-2.5 py-1.5 text-[12px] font-medium text-brand-800 ring-1 ring-brand-200">
              <FileSpreadsheet className="h-3.5 w-3.5 text-brand-600" aria-hidden />Invoiced vs collected · Excel
            </span>
          </div>
        </div>
      </div>
      <p className="mt-4 text-center text-[11px] text-slate-400">Illustration — sample data</p>
    </div>
  );
}

export default async function HomePage() {
  const signedIn = !!(await getUser());
  const cta = signedIn ? { href: "/dashboard", label: "Open dashboard" } : { href: "/login", label: `Start ${TRIAL_DAYS}-day free trial` };

  return (
    <div className="min-h-screen bg-white">
      <MarketingHeader signedIn={signedIn} />

      {/* Hero */}
      <section className="relative overflow-hidden bg-gradient-to-b from-brand-50 to-white">
        <div className="mx-auto grid max-w-6xl items-center gap-12 px-5 py-16 md:py-24 lg:grid-cols-[1.05fr_1fr]">
          <div>
            <span className="inline-flex items-center gap-2 rounded-full bg-white px-3 py-1.5 text-xs font-semibold text-brand-800 ring-1 ring-brand-200">
              <Sparkles className="h-3.5 w-3.5 text-brand-500" aria-hidden />New: ask your business anything with the AI assistant
            </span>
            <h1 className="mt-5 text-4xl font-bold leading-[1.08] tracking-tight text-brand-950 md:text-[56px]">
              From first call<br />to final payment.
            </h1>
            <p className="mt-5 max-w-xl text-lg leading-relaxed text-slate-600">
              Clients, projects, purchase orders, milestone invoices and payments in one place — plus an AI assistant that finds any PO or invoice,
              compares periods and exports reports to Excel, Word or PDF in seconds.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href={cta.href} className={cx(buttonClass("primary"), "h-12 px-6 text-[15px]")}>{cta.label}<ArrowRight className="h-4 w-4" aria-hidden /></Link>
              <Link href="/pricing" className={cx(buttonClass("secondary"), "h-12 px-6 text-[15px]")}>See pricing</Link>
            </div>
            <ul className="mt-6 flex flex-wrap gap-x-6 gap-y-2 text-sm text-slate-600">
              {["Free for 14 days, no card", "Every feature included", "Paid plans from $10/month"].map((t) => (
                <li key={t} className="inline-flex items-center gap-1.5"><Check className="h-4 w-4 text-brand-500" aria-hidden />{t}</li>
              ))}
            </ul>
          </div>
          <div className="rounded-[28px] bg-brand-900 p-5 md:p-7"><AssistantMock /></div>
        </div>
      </section>

      {/* AI assistant spotlight */}
      <section id="assistant" className="scroll-mt-20 bg-brand-950 text-white">
        <div className="mx-auto grid max-w-6xl gap-12 px-5 py-20 lg:grid-cols-2">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-brand-300">AI assistant</div>
            <h2 className="mt-2 text-3xl font-bold tracking-tight md:text-[38px] md:leading-[1.15]">Ask in plain language.<br />Get answers from your live data.</h2>
            <p className="mt-4 text-[16px] leading-relaxed text-brand-100/80">
              The assistant reads your clients, projects, POs, invoices and payments — and only what each user is allowed to see.
              Totals are calculated by the app, not guessed, and every answer links back to the records.
            </p>
            <ul className="mt-8 space-y-4">
              {[
                { icon: Search, t: "Find anything in detail", d: "Any PO or invoice with its milestones, lines, payments and balance." },
                { icon: Split, t: "Compare and rank", d: "Invoiced vs collected by month, client or project; top clients by outstanding; overdue lists." },
                { icon: FileSpreadsheet, t: "Export in one sentence", d: "“…export to Excel” — or Word, or PDF. The file appears as a download button." },
                { icon: KeyRound, t: "Your Google Gemini key", d: "Add it once in Settings; it's stored encrypted. Choose the model that fits your budget." },
              ].map(({ icon: Icon, t, d }) => (
                <li key={t} className="flex gap-4">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/10"><Icon className="h-5 w-5 text-brand-300" aria-hidden /></span>
                  <span><span className="block font-semibold">{t}</span><span className="block text-sm text-brand-100/75">{d}</span></span>
                </li>
              ))}
            </ul>
          </div>
          <div className="self-center">
            <div className="text-sm font-semibold text-brand-200">Try asking…</div>
            <div className="mt-3 grid gap-3">
              {QUESTIONS.map((q) => (
                <div key={q} className="flex items-center gap-3 rounded-2xl bg-white/5 px-4 py-3.5 text-[15px] ring-1 ring-white/10">
                  <Sparkles className="h-4 w-4 shrink-0 text-brand-300" aria-hidden />{q}
                </div>
              ))}
            </div>
            <div className="mt-5 flex flex-wrap gap-2 text-xs text-brand-100/80">
              {[{ i: FileSpreadsheet, l: "Excel" }, { i: FileType2, l: "Word" }, { i: FileText, l: "PDF" }].map(({ i: Icon, l }) => (
                <span key={l} className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1.5"><Icon className="h-3.5 w-3.5" aria-hidden />{l} export</span>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* All features */}
      <section id="features" className="scroll-mt-20">
        <div className="mx-auto max-w-6xl px-5 py-20">
          <SectionTitle eyebrow="Everything included" title="All the tools to run sales-to-cash" center>
            Every plan includes every feature. Plans differ only by the number of users.
          </SectionTitle>
          <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            <div className="rounded-[20px] bg-brand-500 p-6 text-white sm:col-span-2 lg:col-span-1">
              <Sparkles className="h-6 w-6" aria-hidden />
              <h3 className="mt-4 text-lg font-semibold">AI assistant</h3>
              <p className="mt-1.5 text-sm text-white/85">Questions, comparisons and custom reports over all your data — exported to Excel, Word or PDF.</p>
              <Link href="/#assistant" className="mt-4 inline-flex items-center gap-1 text-sm font-semibold underline underline-offset-2">How it works<ArrowRight className="h-3.5 w-3.5" aria-hidden /></Link>
            </div>
            {FEATURES.map(({ icon: Icon, title, text }) => (
              <div key={title} className="rounded-[20px] bg-surface p-6 ring-1 ring-slate-200/70">
                <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-lime-soft"><Icon className="h-5 w-5 text-brand-700" aria-hidden /></span>
                <h3 className="mt-4 text-[17px] font-semibold text-slate-900">{title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-slate-600">{text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How it works */}
      <section id="how" className="scroll-mt-20 bg-surface">
        <div className="mx-auto max-w-6xl px-5 py-20">
          <SectionTitle eyebrow="How it works" title="One flow, from client to cash" center />
          <ol className="mt-12 grid gap-4 md:grid-cols-5">
            {STEPS.map((s) => (
              <li key={s.n} className="rounded-[20px] bg-white p-5 ring-1 ring-slate-200/70">
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-500 text-sm font-bold text-white">{s.n}</span>
                <div className="mt-3 font-semibold text-slate-900">{s.title}</div>
                <p className="mt-1 text-sm text-slate-600">{s.text}</p>
              </li>
            ))}
          </ol>
          <div className="mt-8 grid gap-4 md:grid-cols-3">
            {[
              { icon: CreditCard, t: "Milestone billing", d: "50/50 or 30/40/30 — invoices follow the plan and can't exceed the PO." },
              { icon: Wallet, t: "Partial payments handled", d: "Pay 1,000 of 2,000 and the remaining 1,000 moves to a new invoice." },
              { icon: ScrollText, t: "Nothing is lost", d: "Cancel and reissue instead of deleting; the audit log keeps the story." },
            ].map(({ icon: Icon, t, d }) => (
              <div key={t} className="flex gap-3 rounded-2xl bg-lime-soft/60 p-5">
                <Icon className="mt-0.5 h-5 w-5 shrink-0 text-brand-700" aria-hidden />
                <span><span className="block font-semibold text-brand-950">{t}</span><span className="text-sm text-lime-ink">{d}</span></span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="scroll-mt-20">
        <div className="mx-auto max-w-6xl px-5 py-20">
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

      {/* FAQ */}
      <section className="bg-surface">
        <div className="mx-auto max-w-3xl px-5 py-20">
          <SectionTitle eyebrow="Questions" title="Good to know" center />
          <div className="mt-10 space-y-3">
            {FAQ.map((f) => (
              <details key={f.q} className="group rounded-2xl bg-white px-5 py-4 ring-1 ring-slate-200/70">
                <summary className="flex items-center justify-between gap-4 font-semibold text-slate-900">
                  {f.q}<span className="text-brand-500 transition group-open:rotate-45" aria-hidden>+</span>
                </summary>
                <p className="mt-2 text-sm leading-relaxed text-slate-600">{f.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="mx-auto max-w-6xl px-5 py-20">
        <div className="flex flex-col items-start justify-between gap-6 rounded-[28px] bg-brand-500 px-8 py-10 text-white md:flex-row md:items-center">
          <div>
            <h2 className="text-2xl font-bold md:text-3xl">Ready to see your business at a glance?</h2>
            <p className="mt-1 text-white/85">{TRIAL_DAYS} days free, every feature, no card.</p>
          </div>
          <Link href={cta.href} className="inline-flex h-12 items-center gap-2 rounded-xl bg-white px-6 text-[15px] font-semibold text-brand-800 hover:bg-brand-50">
            {cta.label}<ArrowRight className="h-4 w-4" aria-hidden />
          </Link>
        </div>
      </section>

      <MarketingFooter />
    </div>
  );
}
