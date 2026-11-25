"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/server/auth";
import { runAction, str, type ActionState } from "@/server/action";
import { choosePlan } from "@/server/core/subscription";
import type { PlanId } from "@/lib/plans";
import { prisma } from "@/server/db";

/** Activates the plan, then reloads the page with a confirmation (the chosen card's button turns into "Current plan"). */
export async function choosePlanAction(_: ActionState, fd: FormData) {
  const actor = await requireUser({ allowExpired: true }); // must work after the trial ends
  let name = "";
  const res = await runAction(async () => {
    const plan = await choosePlan(prisma, actor, str(fd, "plan") as PlanId);
    name = plan.name;
  });
  if (!res?.ok) return res;
  revalidatePath("/", "layout");
  redirect(`/subscription?flash=${encodeURIComponent(`Plan changed to ${name}`)}`);
}
