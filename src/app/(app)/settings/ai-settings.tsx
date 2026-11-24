"use client";

import { useActionState, useRef, useState } from "react";
import { CheckCircle2, KeyRound } from "lucide-react";
import { SubmitButton, type ActionState } from "@/components/forms";
import { buttonClass, Field, inputClass } from "@/components/ui";
import { saveAiSettingsAction, testAiKeyAction, type AiTestState } from "./actions";

/** Google (Gemini) API key + model. The saved key is never sent to the browser — only whether one exists. */
export function AiSettings({ hasKey, keySource, model, initialModels }: {
  hasKey: boolean; keySource: "settings" | "env" | null; model: string; initialModels?: { name: string; label: string }[] | null;
}) {
  const [saveState, save] = useActionState<ActionState, FormData>(saveAiSettingsAction, null);
  const [testState, test, testing] = useActionState<AiTestState, FormData>(testAiKeyAction, null);
  const [chosen, setChosen] = useState(model);
  const formRef = useRef<HTMLFormElement>(null);
  const models = testState?.models ?? initialModels ?? undefined;
  const modelMissing = !!models && !models.some((m) => m.name === chosen);

  return (
    <form ref={formRef} action={save} className="space-y-4">
      {saveState?.error && <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700">{saveState.error}</div>}
      {saveState?.ok && <div role="status" className="rounded-xl border border-brand-200 bg-brand-50 px-4 py-3 text-sm font-medium text-brand-700">{saveState.message}</div>}

      <p className="text-sm text-slate-600">
        The assistant uses Google Gemini. Create a key at <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer" className="font-medium text-brand-700 underline underline-offset-2">Google AI Studio</a> and paste it here.
        Questions and the data needed to answer them are sent to Google.
      </p>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <KeyRound className="h-4 w-4 text-slate-400" aria-hidden />
        {hasKey
          ? <span className="inline-flex items-center gap-1.5 font-medium text-brand-700"><CheckCircle2 className="h-4 w-4" aria-hidden />A key is saved{keySource === "env" ? " (from the server's GEMINI_API_KEY)" : ""}</span>
          : <span className="text-slate-500">No key saved yet</span>}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={hasKey ? "Replace API key" : "Google API key"} hint={hasKey ? "Leave blank to keep the saved key" : "Starts with AIza…"}>
          <input name="apiKey" type="password" autoComplete="off" spellCheck={false} placeholder={hasKey ? "••••••••••••••••" : "AIza…"} className={inputClass} />
        </Field>
        <Field label="Model" hint={models ? "Recommended: gemini-flash-latest (fast, low cost, reliable with lookups)" : "Use Test key to load the models your key can use"}>
          {models ? (
            <select name="model" value={chosen} onChange={(e) => setChosen(e.target.value)} className={inputClass}>
              {modelMissing && <option value={chosen}>{chosen} — not available, choose another</option>}
              {models.map((m) => <option key={m.name} value={m.name}>{m.name}{m.name === "gemini-flash-latest" ? "  (recommended)" : ""}</option>)}
            </select>
          ) : (
            <input name="model" value={chosen} onChange={(e) => setChosen(e.target.value)} required className={inputClass} />
          )}
        </Field>
      </div>

      {modelMissing && <p role="alert" className="text-sm font-medium text-rose-600">The saved model &ldquo;{chosen}&rdquo; isn&apos;t available to this key — the assistant will fail until you choose another.</p>}
      {testState?.error && <p role="alert" className="text-sm font-medium text-rose-600">{testState.error}</p>}
      {testState?.ok && <p role="status" className="text-sm font-medium text-brand-700">Key works — choose a model and save.</p>}

      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton>Save AI settings</SubmitButton>
        <button type="submit" formAction={test} formNoValidate disabled={testing} className={buttonClass("secondary")}>
          {testing ? "Testing…" : "Test key"}
        </button>
        {hasKey && keySource === "settings" && (
          <label className="ml-auto flex items-center gap-2 text-sm text-slate-600">
            <input type="checkbox" name="removeKey" className="h-4 w-4 accent-brand-600" /> Remove the saved key on save
          </label>
        )}
      </div>
    </form>
  );
}
