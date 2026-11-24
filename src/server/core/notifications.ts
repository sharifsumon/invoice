import { InvoiceStatus, NotificationEvent, Role } from "@/generated/prisma/enums";
import { addDays, audit, today, type Actor, type Db } from "./common";
import { formatMoney } from "./money";
import { can, ForbiddenError } from "./permissions";
import { outstandingOf } from "./money";

/** Default recipients per event (BRD §5.9). Admins can change these in Settings → Notifications. */
export const DEFAULT_RECIPIENTS: Record<NotificationEvent, Role[]> = {
  INVOICE_DUE_SOON: [Role.FINANCE, Role.ADMIN],
  INVOICE_OVERDUE: [Role.FINANCE, Role.MANAGEMENT, Role.ADMIN],
  PO_APPROVED: [Role.FINANCE, Role.PROJECT_MANAGER, Role.MANAGEMENT, Role.ADMIN],
  INVOICE_GENERATION_FAILED: [Role.FINANCE, Role.ADMIN],
  EMAIL_FAILED: [Role.FINANCE, Role.ADMIN],
};

export const EVENT_LABELS: Record<NotificationEvent, string> = {
  INVOICE_DUE_SOON: "Invoice due soon",
  INVOICE_OVERDUE: "Invoice overdue",
  PO_APPROVED: "PO approved",
  INVOICE_GENERATION_FAILED: "Milestone invoice generation failed",
  EMAIL_FAILED: "Invoice email failed",
};

export const DUE_SOON_DAYS = 7;

export async function recipientRoles(db: Db, event: NotificationEvent): Promise<Role[]> {
  const settings = await db.notificationSetting.findMany({ where: { event } });
  return Object.values(Role).filter((r) => {
    const s = settings.find((x) => x.role === r);
    return s ? s.enabled : DEFAULT_RECIPIENTS[event].includes(r);
  });
}

/**
 * Fan out one event to every active user in the enabled roles. `dedupeKey` makes it idempotent per user,
 * so repeated scans or retries never duplicate a notification. Never throws — notifications must not
 * break the business action that triggered them.
 */
export async function notify(db: Db, event: NotificationEvent, n: { title: string; body?: string; link?: string; dedupeKey: string }) {
  try {
    const roles = await recipientRoles(db, event);
    if (!roles.length) return 0;
    const users = await db.user.findMany({ where: { active: true, role: { in: roles } }, select: { id: true } });
    const r = await db.notification.createMany({
      data: users.map((u) => ({ userId: u.id, event, title: n.title, body: n.body ?? null, link: n.link ?? null, dedupeKey: `${event}:${n.dedupeKey}` })),
      skipDuplicates: true,
    });
    return r.count;
  } catch (e) {
    console.error("notify failed", e);
    return 0;
  }
}

/** Scan for invoices due within DUE_SOON_DAYS and overdue invoices. Idempotent (deduped per invoice + due date). */
export async function scanDueNotifications(db: Db, on: Date = today()) {
  const open = [InvoiceStatus.UNPAID, InvoiceStatus.PARTIALLY_PAID];
  const invs = await db.invoice.findMany({
    where: { status: { in: open }, balanceMoved: 0, dueDate: { not: null, lte: addDays(on, DUE_SOON_DAYS) } }, // moved balances are due on their balance invoice
    include: { client: { select: { name: true } } },
  });
  let created = 0;
  for (const i of invs) {
    const due = i.dueDate!.toISOString().slice(0, 10);
    const bal = formatMoney(outstandingOf(i), i.currency);
    if (i.dueDate! < on) {
      created += await notify(db, NotificationEvent.INVOICE_OVERDUE, {
        title: `${i.invoiceNumber} is overdue`, body: `${i.client.name} — ${bal} was due ${due}.`, link: `/invoices/${i.id}`, dedupeKey: `${i.id}:${due}`,
      });
    } else {
      created += await notify(db, NotificationEvent.INVOICE_DUE_SOON, {
        title: `${i.invoiceNumber} is due ${due}`, body: `${i.client.name} — ${bal} outstanding.`, link: `/invoices/${i.id}`, dedupeKey: `${i.id}:${due}`,
      });
    }
  }
  return created;
}

let lastScan = 0;
/** Cheap opportunistic trigger for single-server installs: at most once every 10 minutes per process. */
export async function maybeScan(db: Db) {
  if (Date.now() - lastScan < 10 * 60_000) return;
  lastScan = Date.now();
  await scanDueNotifications(db);
}

export async function setNotificationSetting(db: Db, actor: Actor, event: NotificationEvent, role: Role, enabled: boolean) {
  if (!can(actor.role, "settings", "administer")) throw new ForbiddenError("settings", "administer");
  await db.notificationSetting.upsert({ where: { event_role: { event, role } }, update: { enabled }, create: { event, role, enabled } });
  await db.$transaction(async (tx) => audit(tx, actor, "settings.notifications.updated", "NotificationSetting", `${event}:${role}`, { after: { enabled } }));
}

export async function markRead(db: Db, userId: string, ids: string[] | "all") {
  await db.notification.updateMany({
    where: { userId, readAt: null, ...(ids === "all" ? {} : { id: { in: ids } }) },
    data: { readAt: new Date() },
  });
}
