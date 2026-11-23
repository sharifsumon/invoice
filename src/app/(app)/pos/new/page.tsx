import { requirePermission } from "@/server/auth";
import { can } from "@/server/core/permissions";
import { getSettings } from "@/server/core/settings";
import { prisma } from "@/server/db";
import { Card, PageHeader } from "@/components/ui";
import { createPOAction } from "../actions";
import { POForm } from "../po-form";

export const metadata = { title: "New PO" };

export default async function NewPOPage({ searchParams }: PageProps<"/pos/new">) {
  const user = await requirePermission("pos", "create");
  const sp = await searchParams;
  const { company } = await getSettings(prisma);
  const projects = await prisma.project.findMany({
    where: { status: { not: "CANCELLED" } },
    orderBy: { code: "asc" },
    select: { id: true, code: true, name: true, currency: true, client: { select: { name: true } } },
  });
  return (
    <>
      <PageHeader title="New purchase order" back={{ href: "/pos", label: "Purchase Orders" }} />
      <Card>
        {projects.length === 0 ? <p className="text-sm text-slate-500">Create a project first — every PO belongs to a client project.</p> : (
          <POForm action={createPOAction} projects={projects} defaultProjectId={typeof sp.projectId === "string" ? sp.projectId : undefined} defaultCurrency={company.defaultCurrency} canApprove={can(user.role, "pos", "approve")} />
        )}
      </Card>
    </>
  );
}
