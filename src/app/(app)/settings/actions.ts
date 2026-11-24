"use server";

import { revalidatePath } from "next/cache";
import type { NumberReset } from "@/generated/prisma/enums";
import { requireUser } from "@/server/auth";
import { bool, runAction, str, type ActionState } from "@/server/action";
import { RuleError } from "@/server/core/permissions";
import { removeLogo, updateCompany, updateTemplate, uploadLogo } from "@/server/core/settings";
import { updateInvoiceTemplate } from "@/server/core/email";
import { addRate, deleteRate } from "@/server/core/fx";
import { setNotificationSetting } from "@/server/core/notifications";
import { NotificationEvent, Role } from "@/generated/prisma/enums";
import { prisma } from "@/server/db";

export async function addRateAction(_: ActionState, fd: FormData) {
  const actor = await requireUser();
  return runAction(async () => {
    await addRate(prisma, actor, {
      fromCurrency: str(fd, "fromCurrency"), toCurrency: str(fd, "toCurrency"), rate: str(fd, "rate"),
      effectiveDate: str(fd, "effectiveDate"), source: str(fd, "source"),
    });
    revalidatePath("/settings");
    return "Rate added";
  });
}

export async function deleteRateAction(id: string, _: ActionState, _fd: FormData) {
  const actor = await requireUser();
  return runAction(async () => {
    await deleteRate(prisma, actor, id);
    revalidatePath("/settings");
    return "Rate removed";
  });
}

export async function saveNotificationMatrixAction(_: ActionState, fd: FormData) {
  const actor = await requireUser();
  return runAction(async () => {
    for (const event of Object.values(NotificationEvent)) {
      for (const role of Object.values(Role)) {
        await setNotificationSetting(prisma, actor, event, role, fd.get(`${event}:${role}`) === "on");
      }
    }
    revalidatePath("/settings");
    return "Notification recipients saved";
  });
}

export async function saveEmailTemplateAction(_: ActionState, fd: FormData) {
  const actor = await requireUser();
  return runAction(async () => {
    await updateInvoiceTemplate(prisma, actor, { subject: str(fd, "subject"), body: str(fd, "body") });
    revalidatePath("/settings");
    return "Email template saved";
  });
}

export async function saveCompanyAction(_: ActionState, fd: FormData) {
  const actor = await requireUser();
  return runAction(async () => {
    await updateCompany(prisma, actor, {
      legalName: str(fd, "legalName"), displayName: str(fd, "displayName"), address: str(fd, "address"), email: str(fd, "email"),
      phone: str(fd, "phone"), website: str(fd, "website"), registrationNumber: str(fd, "registrationNumber"), taxNumber: str(fd, "taxNumber"),
      defaultCurrency: str(fd, "defaultCurrency"), bankDetails: str(fd, "bankDetails"), paymentTermsDays: str(fd, "paymentTermsDays"), projectCodePrefix: str(fd, "projectCodePrefix"),
      defaultNotes: str(fd, "defaultNotes"),
    });
    revalidatePath("/settings");
    return "Company profile saved. Existing finalized invoices are unchanged.";
  });
}

export async function saveTemplateAction(_: ActionState, fd: FormData) {
  const actor = await requireUser();
  return runAction(async () => {
    await updateTemplate(prisma, actor, {
      title: str(fd, "title"), logoPosition: str(fd, "logoPosition") as "left" | "right", headerText: str(fd, "headerText"),
      footerText: str(fd, "footerText"), pageSize: str(fd, "pageSize") as "A4" | "LETTER", numberPrefix: str(fd, "numberPrefix"),
      numberPadding: str(fd, "numberPadding"), numberReset: str(fd, "numberReset") as NumberReset, showTax: bool(fd, "showTax"),
      taxLabel: str(fd, "taxLabel"), defaultTaxRate: str(fd, "defaultTaxRate"), defaultTerms: str(fd, "defaultTerms"),
      showAmountInWords: bool(fd, "showAmountInWords"),
    });
    revalidatePath("/settings");
    return "Invoice template saved. Existing finalized invoices are unchanged.";
  });
}

export async function uploadLogoAction(_: ActionState, fd: FormData) {
  const actor = await requireUser();
  return runAction(async () => {
    const f = fd.get("logo");
    if (!(f instanceof File) || f.size === 0) throw new RuleError("Choose an image file");
    await uploadLogo(prisma, actor, Buffer.from(await f.arrayBuffer()));
    revalidatePath("/settings");
    return "Logo updated";
  });
}

export async function removeLogoAction(_: ActionState, _fd: FormData) {
  const actor = await requireUser();
  return runAction(async () => {
    await removeLogo(prisma, actor);
    revalidatePath("/settings");
    return "Logo removed";
  });
}
