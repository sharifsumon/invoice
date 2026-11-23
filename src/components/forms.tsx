"use client";

import { useActionState, useEffect, useRef, useState, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { buttonClass, cx, type BtnVariant } from "./ui";

export type ActionState = { ok?: boolean; error?: string; message?: string; at?: number } | null;
type ServerAction = (prev: ActionState, fd: FormData) => Promise<ActionState>;

export function SubmitButton({ children, variant = "primary", size = "md", pendingText, className, name, value }: {
  children: ReactNode; variant?: BtnVariant; size?: "sm" | "md"; pendingText?: string; className?: string; name?: string; value?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" name={name} value={value} disabled={pending} className={cx(buttonClass(variant, size), className)}>
      {pending ? (pendingText ?? "Saving…") : children}
    </button>
  );
}

export function FormMessage({ state }: { state: ActionState }) {
  if (!state) return null;
  if (state.error) return <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700">{state.error}</div>;
  if (state.ok) return <div role="status" className="rounded-xl border border-brand-200 bg-brand-50 px-4 py-3 text-sm font-medium text-brand-700">{state.message}</div>;
  return null;
}

/** A form bound to a server action, showing success/error feedback inline. */
export function ActionForm({ action, children, className, resetOnSuccess, onSuccess }: {
  action: ServerAction; children: ReactNode; className?: string; resetOnSuccess?: boolean; onSuccess?: () => void;
}) {
  const [state, formAction] = useActionState(action, null);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state?.ok) {
      if (resetOnSuccess) ref.current?.reset();
      onSuccess?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.at]);
  return (
    <form ref={ref} action={formAction} className={cx("space-y-4", className)}>
      <FormMessage state={state} />
      {children}
    </form>
  );
}

/** Button that runs an action, optionally asking for confirmation and/or a reason first. */
export function ActionButton({ action, label, variant = "secondary", size = "sm", confirm, reasonPrompt, hidden, extra }: {
  action: ServerAction; label: string; variant?: BtnVariant; size?: "sm" | "md"; confirm?: string; reasonPrompt?: string;
  hidden?: Record<string, string>; extra?: ReactNode;
}) {
  const [state, formAction] = useActionState(action, null);
  const [open, setOpen] = useState(false);
  const needsDialog = !!reasonPrompt || !!extra;
  return (
    <div className="inline-flex flex-col items-start gap-1">
      {needsDialog && !open ? (
        <button type="button" className={buttonClass(variant, size)} onClick={() => setOpen(true)}>{label}</button>
      ) : (
        <form
          action={formAction}
          onSubmit={(e) => { if (confirm && !window.confirm(confirm)) e.preventDefault(); }}
          className={cx(needsDialog && "w-full max-w-md space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3")}
        >
          {hidden && Object.entries(hidden).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
          {extra}
          {reasonPrompt && (
            <textarea name="reason" required placeholder={reasonPrompt} rows={2}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm" />
          )}
          <div className="flex gap-2">
            <SubmitButton variant={variant} size={size} pendingText="Working…">{needsDialog ? `Confirm ${label.toLowerCase()}` : label}</SubmitButton>
            {needsDialog && <button type="button" className={buttonClass("ghost", size)} onClick={() => setOpen(false)}>Close</button>}
          </div>
        </form>
      )}
      {state?.error && <span role="alert" className="max-w-md text-xs text-rose-600">{state.error}</span>}
      {state?.ok && state.message && state.message !== "Saved" && <span className="max-w-md text-xs text-brand-700">{state.message}</span>}
    </div>
  );
}
