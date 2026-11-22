import { requireUser } from "@/server/auth";
import { EVENT_LABELS } from "@/server/core/notifications";
import { prisma } from "@/server/db";
import { Badge, buttonClass, Card, cx, PageHeader } from "@/components/ui";
import { markAllReadAction, openNotificationAction } from "./actions";

export const metadata = { title: "Notifications" };

export default async function NotificationsPage() {
  const user = await requireUser();
  const items = await prisma.notification.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, take: 200 });
  const unread = items.filter((n) => !n.readAt).length;
  return (
    <>
      <PageHeader title="Notifications" subtitle={`${unread} unread`}
        actions={unread > 0 && <form action={markAllReadAction}><button className={buttonClass("secondary")}>Mark all as read</button></form>} />
      <Card>
        {items.length === 0 && <p className="py-8 text-center text-sm text-slate-400">You&apos;re all caught up.</p>}
        <ul className="divide-y divide-slate-100">
          {items.map((n) => (
            <li key={n.id}>
              <form action={openNotificationAction.bind(null, n.id)}>
                <button className={cx("flex w-full items-start gap-3 px-2 py-3 text-left hover:bg-slate-50", !n.readAt && "bg-brand-50/40")}>
                  <span className={cx("mt-1.5 h-2 w-2 shrink-0 rounded-full", n.readAt ? "bg-transparent" : "bg-brand-600")} />
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className={cx("text-sm", n.readAt ? "text-slate-700" : "font-semibold text-slate-900")}>{n.title}</span>
                      <Badge tone={n.event === "INVOICE_OVERDUE" || n.event.endsWith("FAILED") ? "red" : n.event === "INVOICE_DUE_SOON" ? "amber" : "green"}>{EVENT_LABELS[n.event]}</Badge>
                    </span>
                    {n.body && <span className="mt-0.5 block text-sm text-slate-500">{n.body}</span>}
                    <span className="mt-0.5 block text-xs text-slate-400">{n.createdAt.toISOString().slice(0, 16).replace("T", " ")}</span>
                  </span>
                </button>
              </form>
            </li>
          ))}
        </ul>
      </Card>
    </>
  );
}
