import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import type { Role } from "@/generated/prisma/enums";
import { RuleError } from "./permissions";

export type Db = PrismaClient;
export type Tx = Prisma.TransactionClient;

export interface Actor {
  id: string;
  role: Role;
  name: string;
}

/** Convert Decimals/Dates to plain JSON for audit snapshots. */
export function toJson(v: unknown): Prisma.InputJsonValue | undefined {
  if (v === undefined || v === null) return undefined;
  return JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue;
}

export async function audit(
  tx: Tx,
  actor: Actor | null,
  action: string,
  entityType: string,
  entityId: string,
  data: { before?: unknown; after?: unknown; reason?: string | null } = {},
) {
  await tx.auditLog.create({
    data: {
      actorId: actor?.id ?? null,
      action,
      entityType,
      entityId,
      before: toJson(data.before),
      after: toJson(data.after),
      reason: data.reason ?? null,
    },
  });
}

const DB_RULE_MESSAGES: Record<string, string> = {
  PO_CAP_EXCEEDED: "This would make valid invoices exceed the approved PO value. The PO cap cannot be overridden.",
  PO_NOT_APPROVED: "Invoices can only be raised against an approved PO.",
  CURRENCY_MISMATCH: "Invoice currency must match the PO currency.",
  AUDIT_IMMUTABLE: "Audit records cannot be changed.",
  OVERPAYMENT: "This payment exceeds the invoice's outstanding balance.",
  PAYMENT_NOT_ALLOWED: "Payments can only be recorded on finalized, unpaid invoices.",
  PAYMENT_IMMUTABLE: "Recorded payments cannot be edited or deleted — reverse them instead.",
};

/** Turn database guard / constraint errors into user-facing RuleErrors. */
export function translateDbError(err: unknown): unknown {
  const msg = err instanceof Error ? err.message : String(err);
  for (const [code, text] of Object.entries(DB_RULE_MESSAGES)) {
    if (msg.includes(code)) return new RuleError(text);
  }
  if (msg.includes("Invoice_active_milestone_key")) {
    return new RuleError("This milestone already has a valid invoice.");
  }
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
    const target = JSON.stringify(err.meta ?? {});
    return new RuleError(`A record with this value already exists (${target.replace(/[{}"[\]]/g, "")}).`);
  }
  return err;
}

/** Run a serializable-enough interactive transaction and translate DB rule errors. */
export async function inTx<T>(db: Db, fn: (tx: Tx) => Promise<T>): Promise<T> {
  try {
    return await db.$transaction(fn, { timeout: 20_000, maxWait: 10_000 });
  } catch (e) {
    throw translateDbError(e);
  }
}

export function today(): Date {
  const d = new Date();
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
}

export function addDays(d: Date, days: number): Date {
  return new Date(d.getTime() + days * 86_400_000);
}

export function parseDate(v: string | null | undefined): Date | null {
  if (!v) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v.trim());
  if (!m) throw new RuleError(`Invalid date: ${v}`);
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
}
