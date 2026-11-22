"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/server/auth";
import { markRead } from "@/server/core/notifications";
import { prisma } from "@/server/db";

export async function markAllReadAction() {
  const u = await requireUser();
  await markRead(prisma, u.id, "all");
  revalidatePath("/", "layout");
}

/** Mark one as read, then follow its link. */
export async function openNotificationAction(id: string) {
  const u = await requireUser();
  const n = await prisma.notification.findFirst({ where: { id, userId: u.id } });
  if (!n) redirect("/notifications");
  await markRead(prisma, u.id, [id]);
  revalidatePath("/", "layout");
  redirect(n.link && n.link.startsWith("/") ? n.link : "/notifications");
}
