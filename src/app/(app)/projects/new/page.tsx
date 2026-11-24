import { requirePermission } from "@/server/auth";
import { peekNextProjectCode } from "@/server/core/projects";
import { getSettings } from "@/server/core/settings";
import { prisma } from "@/server/db";
import { Card, PageHeader } from "@/components/ui";
import { createProjectAction } from "../actions";
import { ProjectForm } from "../project-form";

export const metadata = { title: "New project" };

export default async function NewProjectPage({ searchParams }: PageProps<"/projects/new">) {
  await requirePermission("projects", "create");
  const sp = await searchParams;
  const [clients, managers, { company }, nextCode] = await Promise.all([
    prisma.client.findMany({ where: { archived: false }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.user.findMany({ where: { active: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    getSettings(prisma),
    peekNextProjectCode(prisma),
  ]);
  return (
    <>
      <PageHeader title="New project" back={{ href: "/projects", label: "Projects" }} />
      <Card>
        {clients.length === 0 ? (
          <p className="text-sm text-slate-500">Create a client first — every project belongs to a client.</p>
        ) : (
          <ProjectForm action={createProjectAction} clients={clients} managers={managers} isNew nextCode={nextCode}
            defaultClientId={typeof sp.clientId === "string" ? sp.clientId : undefined} defaultCurrency={company.defaultCurrency} submitLabel="Create project" />
        )}
      </Card>
    </>
  );
}
