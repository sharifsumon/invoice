"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/server/auth";
import { bool, runAction, str, type ActionState } from "@/server/action";
import { addActivity, createClient, deleteContact, setClientArchived, updateClient, upsertContact } from "@/server/core/clients";
import type { ActivityType, ClientStatus } from "@/generated/prisma/enums";
import { prisma } from "@/server/db";

function clientFields(fd: FormData) {
  return {
    name: str(fd, "name"), legalName: str(fd, "legalName"), address: str(fd, "address"), country: str(fd, "country"),
    website: str(fd, "website"), industry: str(fd, "industry"), taxId: str(fd, "taxId"), email: str(fd, "email"),
    phone: str(fd, "phone"), remarks: str(fd, "remarks"), status: str(fd, "status") as ClientStatus,
  };
}

export async function createClientAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const actor = await requireUser();
  let id = "";
  const res = await runAction(async () => {
    const contact = {
      firstName: str(fd, "contactFirstName"), lastName: str(fd, "contactLastName"), designation: str(fd, "contactDesignation"),
      email: str(fd, "contactEmail"), phone: str(fd, "contactPhone"), isPrimary: true,
    };
    id = (await createClient(prisma, actor, clientFields(fd), [contact])).id;
  });
  if (res?.ok) redirect(`/clients/${id}`);
  return res;
}

/** Saves, then closes the edit form with a confirmation. */
export async function updateClientAction(id: string, _: ActionState, fd: FormData) {
  const actor = await requireUser();
  const res = await runAction(async () => {
    await updateClient(prisma, actor, id, clientFields(fd));
    return "Client updated";
  });
  if (!res?.ok) return res;
  revalidatePath(`/clients/${id}`);
  redirect(`/clients/${id}?flash=Client+updated`);
}

export async function archiveClientAction(id: string, archived: boolean, _: ActionState, _fd: FormData) {
  const actor = await requireUser();
  return runAction(async () => {
    await setClientArchived(prisma, actor, id, archived);
    revalidatePath(`/clients/${id}`);
    return archived ? "Client archived" : "Client restored";
  });
}

export async function saveContactAction(clientId: string, contactId: string | undefined, _: ActionState, fd: FormData) {
  const actor = await requireUser();
  return runAction(async () => {
    await upsertContact(prisma, actor, clientId, {
      firstName: str(fd, "firstName"), lastName: str(fd, "lastName"), designation: str(fd, "designation"), email: str(fd, "email"),
      phone: str(fd, "phone"), department: str(fd, "department"), isPrimary: bool(fd, "isPrimary"),
    }, contactId);
    revalidatePath(`/clients/${clientId}`);
    return "Contact saved";
  });
}

export async function deleteContactAction(clientId: string, contactId: string, _: ActionState, _fd: FormData) {
  const actor = await requireUser();
  return runAction(async () => {
    await deleteContact(prisma, actor, clientId, contactId);
    revalidatePath(`/clients/${clientId}`);
    return "Contact removed";
  });
}

export async function addActivityAction(clientId: string, _: ActionState, fd: FormData) {
  const actor = await requireUser();
  return runAction(async () => {
    await addActivity(prisma, actor, clientId, {
      type: str(fd, "type") as ActivityType, subject: str(fd, "subject"), body: str(fd, "body"), occurredAt: str(fd, "occurredAt") || undefined,
    });
    revalidatePath(`/clients/${clientId}`);
    return "Activity logged";
  });
}
