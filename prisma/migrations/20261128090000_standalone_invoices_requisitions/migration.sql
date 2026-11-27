-- 1) Individual (standalone) invoices: a MANUAL invoice can be raised straight to a client,
--    without a project or purchase order. PO rules apply only when a PO is linked.
ALTER TABLE "Invoice" ALTER COLUMN "projectId" DROP NOT NULL;
ALTER TABLE "Invoice" ALTER COLUMN "poId" DROP NOT NULL;
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_po_link_valid" CHECK (
  ("poId" IS NOT NULL AND "projectId" IS NOT NULL)
  OR ("poId" IS NULL AND "kind"::text IN ('MANUAL', 'BALANCE') AND "milestoneId" IS NULL)
);

CREATE OR REPLACE FUNCTION enforce_po_invoice_cap() RETURNS trigger AS $$
DECLARE
  po_value  numeric(18,2);
  po_status text;
  po_cur    text;
  used      numeric(18,2);
BEGIN
  IF NEW."status" = 'CANCELLED' OR NEW."poId" IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT "value", "status"::text, "currency" INTO po_value, po_status, po_cur
    FROM "PurchaseOrder" WHERE "id" = NEW."poId" FOR UPDATE;

  IF NEW."status" = 'DRAFT' THEN
    IF po_status NOT IN ('SUBMITTED', 'ON_HOLD', 'APPROVED', 'COMPLETED') THEN
      RAISE EXCEPTION 'PO_NOT_APPROVED: invoices can only be drafted against a submitted or approved PO'
        USING ERRCODE = 'P0001';
    END IF;
  ELSIF po_status NOT IN ('APPROVED', 'COMPLETED') THEN
    RAISE EXCEPTION 'PO_NOT_APPROVED: invoices can only be issued against an approved PO'
      USING ERRCODE = 'P0001';
  END IF;

  IF NEW."currency" <> po_cur THEN
    RAISE EXCEPTION 'CURRENCY_MISMATCH: invoice currency must match PO currency' USING ERRCODE = 'P0001';
  END IF;

  IF NEW."kind"::text = 'BALANCE' THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(SUM("subtotal" - "discount"), 0) INTO used
    FROM "Invoice"
   WHERE "poId" = NEW."poId" AND "status" <> 'CANCELLED' AND "kind"::text <> 'BALANCE' AND "id" <> NEW."id";

  IF used + (NEW."subtotal" - NEW."discount") > po_value THEN
    RAISE EXCEPTION 'PO_CAP_EXCEEDED: invoices would total % against PO value %',
      used + (NEW."subtotal" - NEW."discount"), po_value USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 2) Requisitions: internal requests for items, with an approval step.
CREATE TYPE "RequisitionStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'FULFILLED', 'CANCELLED');
CREATE TYPE "RequisitionPriority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'URGENT');

CREATE TABLE "Requisition" (
    "id" TEXT NOT NULL,
    "number" TEXT,
    "title" TEXT NOT NULL,
    "department" TEXT,
    "projectId" TEXT,
    "priority" "RequisitionPriority" NOT NULL DEFAULT 'NORMAL',
    "neededBy" DATE,
    "deliverTo" TEXT,
    "purpose" TEXT,
    "currency" CHAR(3) NOT NULL,
    "estimatedTotal" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "status" "RequisitionStatus" NOT NULL DEFAULT 'DRAFT',
    "requestedById" TEXT NOT NULL,
    "submittedAt" TIMESTAMP(3),
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "fulfilledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Requisition_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Requisition_number_key" ON "Requisition"("number");
CREATE INDEX "Requisition_status_idx" ON "Requisition"("status");
CREATE INDEX "Requisition_requestedById_idx" ON "Requisition"("requestedById");
ALTER TABLE "Requisition" ADD CONSTRAINT "Requisition_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Requisition" ADD CONSTRAINT "Requisition_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Requisition" ADD CONSTRAINT "Requisition_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Requisition" ADD CONSTRAINT "Requisition_total_valid" CHECK ("estimatedTotal" >= 0);

CREATE TABLE "RequisitionItem" (
    "id" TEXT NOT NULL,
    "requisitionId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(18,4) NOT NULL,
    "unit" TEXT,
    "unitPrice" DECIMAL(18,2),
    "amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    CONSTRAINT "RequisitionItem_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "RequisitionItem" ADD CONSTRAINT "RequisitionItem_requisitionId_fkey" FOREIGN KEY ("requisitionId") REFERENCES "Requisition"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RequisitionItem" ADD CONSTRAINT "RequisitionItem_values_valid" CHECK ("quantity" > 0 AND ("unitPrice" IS NULL OR "unitPrice" >= 0));

-- Built-in groups: everyone can raise requisitions; admin, management and finance can approve them.
UPDATE "UserGroup" SET "permissions" = "permissions" || '{"requisitions":["view","create","edit","delete","approve","export"]}'::jsonb WHERE "key" = 'ADMIN';
UPDATE "UserGroup" SET "permissions" = "permissions" || '{"requisitions":["view","create","approve","export"]}'::jsonb WHERE "key" IN ('MANAGEMENT', 'FINANCE');
UPDATE "UserGroup" SET "permissions" = "permissions" || '{"requisitions":["view","create"]}'::jsonb WHERE "key" IN ('BUSINESS_DEVELOPMENT', 'PROJECT_MANAGER');
UPDATE "UserGroup" SET "permissions" = "permissions" || '{"requisitions":["view"]}'::jsonb WHERE "key" = 'VIEWER';
