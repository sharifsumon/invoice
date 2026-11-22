import "server-only";
import { unstable_rethrow } from "next/navigation";
import { ZodError } from "zod";
import { ForbiddenError, RuleError } from "./core/permissions";

export type ActionState = { ok?: boolean; error?: string; message?: string; at?: number } | null;

/** Run a mutation and convert expected failures into a form-friendly result. */
export async function runAction(fn: () => Promise<string | void>): Promise<ActionState> {
  try {
    const message = await fn();
    return { ok: true, message: message || "Saved", at: Date.now() };
  } catch (e) {
    unstable_rethrow(e); // let redirect()/notFound() through
    if (e instanceof RuleError || e instanceof ForbiddenError) return { error: e.message, at: Date.now() };
    if (e instanceof ZodError) {
      return { error: e.issues.map((i) => (i.path.length ? `${i.path.join(".")}: ` : "") + i.message).join("; "), at: Date.now() };
    }
    console.error(e);
    return { error: "Something went wrong. The change was not saved.", at: Date.now() };
  }
}

export function str(fd: FormData, key: string): string {
  const v = fd.get(key);
  return typeof v === "string" ? v : "";
}

export function bool(fd: FormData, key: string): boolean {
  const v = fd.get(key);
  return v === "on" || v === "true" || v === "1";
}
