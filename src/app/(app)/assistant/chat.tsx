"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ArrowUp, Download, FileSpreadsheet, FileText, FileType2, RotateCcw, Sparkles } from "lucide-react";
import { buttonClass, cx } from "@/components/ui";

type File = { name: string; title: string; format: "xlsx" | "docx" | "pdf"; url: string; size: number };
type Msg = { role: "user" | "assistant"; text: string; files?: File[]; error?: boolean };

const STORE = "crm-assistant-chat";
const FORMAT: Record<File["format"], { label: string; Icon: typeof FileText }> = {
  xlsx: { label: "Excel", Icon: FileSpreadsheet }, docx: { label: "Word", Icon: FileType2 }, pdf: { label: "PDF", Icon: FileText },
};

const SUGGESTIONS = [
  "Which invoices are overdue right now?",
  "Compare invoiced vs collected by month this year",
  "Show PO details and payments for my largest PO",
  "Top 5 clients by outstanding balance",
  "Which approved POs still have value left to invoice?",
  "Export all unpaid invoices to Excel",
];

/** Markdown with GFM tables; internal links use the app router. */
function Answer({ text }: { text: string }) {
  return (
    <div className="assistant-md text-[14px] leading-relaxed text-slate-800">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={{
        a: ({ href = "", children }) => href.startsWith("/")
          ? <Link href={href} className="font-medium text-brand-700 underline underline-offset-2">{children}</Link>
          : <a href={href} target="_blank" rel="noreferrer noopener" className="font-medium text-brand-700 underline underline-offset-2">{children}</a>,
        table: ({ children }) => <div className="my-3 overflow-x-auto rounded-xl ring-1 ring-slate-200"><table className="w-full text-[13px]">{children}</table></div>,
        thead: ({ children }) => <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">{children}</thead>,
        th: ({ children }) => <th className="whitespace-nowrap px-3 py-2">{children}</th>,
        td: ({ children }) => <td className="border-t border-slate-100 px-3 py-2 align-top">{children}</td>,
        ul: ({ children }) => <ul className="my-2 list-disc space-y-1 pl-5">{children}</ul>,
        ol: ({ children }) => <ol className="my-2 list-decimal space-y-1 pl-5">{children}</ol>,
        p: ({ children }) => <p className="my-2 first:mt-0 last:mb-0">{children}</p>,
        h1: ({ children }) => <h3 className="mt-3 mb-1 text-base font-semibold">{children}</h3>,
        h2: ({ children }) => <h3 className="mt-3 mb-1 text-base font-semibold">{children}</h3>,
        h3: ({ children }) => <h4 className="mt-3 mb-1 font-semibold">{children}</h4>,
        code: ({ children }) => <code className="rounded bg-slate-100 px-1 py-0.5 text-[12px]">{children}</code>,
      }}>{text}</ReactMarkdown>
    </div>
  );
}

export function Chat({ userName, canExport }: { userName: string; canExport: boolean }) {
  // Rendered client-only (see chat-loader), so the saved conversation for this tab can be read up front
  const [msgs, setMsgs] = useState<Msg[]>(() => {
    try { return JSON.parse(sessionStorage.getItem(STORE) ?? "[]") as Msg[]; } catch { return []; }
  });
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLTextAreaElement>(null);

  // Keep the conversation for this browser tab
  useEffect(() => {
    try { sessionStorage.setItem(STORE, JSON.stringify(msgs.slice(-40))); } catch { /* ignore */ }
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [msgs, busy]);

  async function send(text: string) {
    const q = text.trim();
    if (!q || busy) return;
    const next: Msg[] = [...msgs, { role: "user", text: q }];
    setMsgs(next);
    setInput("");
    setBusy(true);
    try {
      const res = await fetch("/api/assistant", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ messages: next.filter((m) => !m.error).map(({ role, text }) => ({ role, text })) }),
      });
      const data = await res.json().catch(() => ({ error: "The server sent an unexpected response." }));
      setMsgs((m) => [...m, res.ok ? { role: "assistant", text: data.text, files: data.files } : { role: "assistant", text: data.error ?? "Something went wrong.", error: true }]);
    } catch {
      setMsgs((m) => [...m, { role: "assistant", text: "Couldn't reach the server. Check your connection and try again.", error: true }]);
    } finally {
      setBusy(false);
      boxRef.current?.focus();
    }
  }

  const onSubmit = (e: FormEvent) => { e.preventDefault(); void send(input); };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(input); }
  };

  return (
    <section className="flex min-h-[calc(100vh-15rem)] flex-col rounded-[20px] bg-white shadow-[0_1px_2px_rgba(16,40,32,0.04)]">
      <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-3">
        <span className="flex items-center gap-2 text-sm font-semibold text-slate-900"><Sparkles className="h-4 w-4 text-brand-500" aria-hidden />Assistant</span>
        {msgs.length > 0 && (
          <button type="button" onClick={() => { setMsgs([]); sessionStorage.removeItem(STORE); }} className={buttonClass("ghost", "sm")}>
            <RotateCcw className="h-3.5 w-3.5" aria-hidden />New chat
          </button>
        )}
      </div>

      <div className="flex-1 space-y-5 overflow-y-auto px-5 py-5" aria-live="polite">
        {msgs.length === 0 && (
          <div className="mx-auto max-w-2xl py-8 text-center">
            <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-lime-soft"><Sparkles className="h-6 w-6 text-brand-700" aria-hidden /></span>
            <h2 className="mt-4 text-lg font-semibold text-slate-900">Hi {userName}, what would you like to know?</h2>
            <p className="mt-1 text-sm text-slate-500">
              Ask in plain language — about a PO, an invoice, a client, or comparisons across periods.
              {canExport ? " Ask for Excel, Word or PDF to get a file." : ""}
            </p>
            <div className="mt-6 flex flex-wrap justify-center gap-2">
              {SUGGESTIONS.filter((s) => canExport || !/export/i.test(s)).map((s) => (
                <button key={s} type="button" onClick={() => void send(s)}
                  className="rounded-full bg-brand-50 px-3.5 py-2 text-sm text-brand-800 ring-1 ring-brand-100 transition hover:bg-brand-100">{s}</button>
              ))}
            </div>
          </div>
        )}

        {msgs.map((m, i) => m.role === "user" ? (
          <div key={i} className="flex justify-end">
            <div className="max-w-[80%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-brand-500 px-4 py-2.5 text-[14px] text-white">{m.text}</div>
          </div>
        ) : (
          <div key={i} className="flex gap-3">
            <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-lime-soft"><Sparkles className="h-4 w-4 text-brand-700" aria-hidden /></span>
            <div className={cx("min-w-0 max-w-[90%] rounded-2xl rounded-tl-md px-4 py-3", m.error ? "bg-rose-50 text-rose-700" : "bg-surface")}>
              {m.error ? <p className="text-sm font-medium" role="alert">{m.text}</p> : <Answer text={m.text} />}
              {!!m.files?.length && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {m.files.map((f) => {
                    const { label, Icon } = FORMAT[f.format];
                    return (
                      <a key={f.name} href={f.url} download className="inline-flex items-center gap-2 rounded-xl bg-white px-3 py-2 text-sm font-medium text-brand-800 ring-1 ring-brand-200 transition hover:bg-brand-50">
                        <Icon className="h-4 w-4 text-brand-600" aria-hidden />
                        <span>{f.title} <span className="font-normal text-slate-500">· {label} · {Math.max(1, Math.round(f.size / 1024))} KB</span></span>
                        <Download className="h-4 w-4 text-slate-400" aria-hidden />
                      </a>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        ))}

        {busy && (
          <div className="flex gap-3" role="status">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-lime-soft"><Sparkles className="h-4 w-4 animate-pulse text-brand-700" aria-hidden /></span>
            <div className="rounded-2xl rounded-tl-md bg-surface px-4 py-3 text-sm text-slate-500">Looking through your data…</div>
          </div>
        )}
        <div ref={endRef} />
      </div>

      <form onSubmit={onSubmit} className="border-t border-slate-100 p-4">
        <div className="flex items-end gap-2 rounded-2xl bg-surface p-2 ring-1 ring-slate-200 focus-within:ring-2 focus-within:ring-brand-500/40">
          <textarea ref={boxRef} value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={onKey} rows={1} maxLength={4000}
            placeholder="Ask about POs, invoices, clients… (Shift+Enter for a new line)" aria-label="Message"
            className="max-h-40 min-h-[40px] flex-1 resize-none bg-transparent px-2 py-2 text-[14px] text-slate-900 placeholder:text-slate-400 focus:outline-none"
            style={{ height: Math.min(160, 40 + Math.max(0, input.split("\n").length - 1) * 20) }} />
          <button type="submit" disabled={busy || !input.trim()} aria-label="Send"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-500 text-white transition hover:bg-brand-600 disabled:bg-brand-200">
            <ArrowUp className="h-5 w-5" aria-hidden />
          </button>
        </div>
        <p className="mt-2 px-1 text-[11px] text-slate-400">AI answers can be wrong — check important numbers against the records it links to.</p>
      </form>
    </section>
  );
}
