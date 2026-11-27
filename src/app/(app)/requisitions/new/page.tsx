import Link from "next/link";
import { requirePermission } from "@/server/auth";
import { can } from "@/server/core/permissions";
import { prisma } from "@/server/db";
import { buttonClass, Card, PageHeader } from "@/components/ui";
import { createRequisitionAction } from "../actions";
import { RequisitionForm } from "../requisition-form";

export const metadata = { title: "New requisition" };

export default async function NewRequisitionPage() {
  const user = await requirePermission("requisitions", "create");
  const [departments, company] = await Promise.all([
    prisma.department.findMany({ where: { active: true }, orderBy: { name: "asc" }, select: { id: true, name: true, active: true } }),
    prisma.companySettings.findUnique({ where: { id: 1 }, select: { defaultCurrency: true } }),
  ]);
  return (
    <>
      <PageHeader back={{ href: "/requisitions", label: "Requisitions" }} title="New requisition"
        subtitle="Request items you need. Submit it for approval, or save it as a draft and finish later." />
      <Card actions={<Link href="/requisitions" className={buttonClass("secondary")}>Cancel</Link>}>
        <RequisitionForm action={createRequisitionAction} departments={departments} currency={company?.defaultCurrency ?? "USD"}
          canManageDepartments={can(user, "settings", "administer")} />
      </Card>
    </>
  );
}
