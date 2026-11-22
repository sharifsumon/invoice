-- CreateEnum
CREATE TYPE "Role" AS ENUM ('ADMIN', 'MANAGEMENT', 'BUSINESS_DEVELOPMENT', 'PROJECT_MANAGER', 'FINANCE', 'VIEWER');

-- CreateEnum
CREATE TYPE "ClientStatus" AS ENUM ('PROSPECT', 'COMMUNICATED', 'ONBOARDED', 'IN_PROGRESS', 'ON_HOLD', 'COMPLETED', 'INACTIVE');

-- CreateEnum
CREATE TYPE "ActivityType" AS ENUM ('NOTE', 'MEETING', 'CALL', 'EMAIL', 'STATUS_CHANGE');

-- CreateEnum
CREATE TYPE "ProjectStatus" AS ENUM ('PROPOSED', 'DRAFT', 'SUBMITTED', 'APPROVED', 'IN_PROGRESS', 'ON_HOLD', 'COMPLETED', 'CANCELLED', 'REJECTED');

-- CreateEnum
CREATE TYPE "POStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'ON_HOLD', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "InvoiceKind" AS ENUM ('MILESTONE', 'MANUAL');

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('DRAFT', 'UNPAID', 'PARTIALLY_PAID', 'PAID', 'CANCELLED');

-- CreateEnum
CREATE TYPE "NumberReset" AS ENUM ('NEVER', 'YEARLY');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'VIEWER',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Client" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "legalName" TEXT,
    "address" TEXT,
    "country" TEXT,
    "website" TEXT,
    "industry" TEXT,
    "taxId" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "remarks" TEXT,
    "status" "ClientStatus" NOT NULL DEFAULT 'COMMUNICATED',
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Client_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientContact" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "designation" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "department" TEXT,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClientContact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientActivity" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "type" "ActivityType" NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClientActivity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Project" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "description" TEXT,
    "startDate" DATE,
    "plannedEndDate" DATE,
    "actualEndDate" DATE,
    "managerId" TEXT,
    "status" "ProjectStatus" NOT NULL DEFAULT 'DRAFT',
    "value" DECIMAL(18,2) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "approved" BOOLEAN NOT NULL DEFAULT false,
    "approvalDate" DATE,
    "remarks" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseOrder" (
    "id" TEXT NOT NULL,
    "poNumber" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "poDate" DATE NOT NULL,
    "value" DECIMAL(18,2) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "paymentTerms" TEXT,
    "reference" TEXT,
    "remarks" TEXT,
    "status" "POStatus" NOT NULL DEFAULT 'DRAFT',
    "approvedAt" TIMESTAMP(3),
    "approvedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PurchaseOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentMilestone" (
    "id" TEXT NOT NULL,
    "poId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "percentage" DECIMAL(9,4) NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "expectedDate" DATE,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentMilestone_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invoice" (
    "id" TEXT NOT NULL,
    "invoiceNumber" TEXT,
    "kind" "InvoiceKind" NOT NULL,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'DRAFT',
    "clientId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "poId" TEXT NOT NULL,
    "milestoneId" TEXT,
    "invoiceDate" DATE,
    "dueDate" DATE,
    "currency" CHAR(3) NOT NULL,
    "subtotal" DECIMAL(18,2) NOT NULL,
    "discount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "taxRate" DECIMAL(9,4) NOT NULL DEFAULT 0,
    "taxAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(18,2) NOT NULL,
    "amountPaid" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "notes" TEXT,
    "terms" TEXT,
    "snapshot" JSONB,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdById" TEXT,
    "finalizedAt" TIMESTAMP(3),
    "finalizedById" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "cancelledById" TEXT,
    "cancelReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvoiceLineItem" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(18,4) NOT NULL,
    "unitPrice" DECIMAL(18,2) NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,

    CONSTRAINT "InvoiceLineItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvoiceDocument" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "filePath" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "revisionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InvoiceDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvoiceSequence" (
    "key" TEXT NOT NULL,
    "next" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "InvoiceSequence_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "CompanySettings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "legalName" TEXT NOT NULL DEFAULT 'Your Company Ltd',
    "displayName" TEXT NOT NULL DEFAULT 'Your Company',
    "address" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "website" TEXT,
    "registrationNumber" TEXT,
    "taxNumber" TEXT,
    "defaultCurrency" CHAR(3) NOT NULL DEFAULT 'USD',
    "bankDetails" TEXT,
    "paymentTermsDays" INTEGER NOT NULL DEFAULT 30,
    "defaultNotes" TEXT,
    "logoPath" TEXT,
    "logoMime" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompanySettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvoiceTemplateSettings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "title" TEXT NOT NULL DEFAULT 'INVOICE',
    "logoPosition" TEXT NOT NULL DEFAULT 'left',
    "headerText" TEXT,
    "footerText" TEXT,
    "pageSize" TEXT NOT NULL DEFAULT 'A4',
    "numberPrefix" TEXT NOT NULL DEFAULT 'INV-',
    "numberPadding" INTEGER NOT NULL DEFAULT 5,
    "numberReset" "NumberReset" NOT NULL DEFAULT 'YEARLY',
    "showTax" BOOLEAN NOT NULL DEFAULT false,
    "taxLabel" TEXT NOT NULL DEFAULT 'VAT',
    "defaultTaxRate" DECIMAL(9,4) NOT NULL DEFAULT 0,
    "defaultTerms" TEXT,
    "showAmountInWords" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InvoiceTemplateSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Attachment" (
    "id" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "filePath" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "uploadedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Attachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExchangeRate" (
    "id" TEXT NOT NULL,
    "fromCurrency" CHAR(3) NOT NULL,
    "toCurrency" CHAR(3) NOT NULL,
    "rate" DECIMAL(18,8) NOT NULL,
    "effectiveDate" DATE NOT NULL,
    "source" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExchangeRate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "Client_name_idx" ON "Client"("name");

-- CreateIndex
CREATE INDEX "ClientContact_clientId_idx" ON "ClientContact"("clientId");

-- CreateIndex
CREATE INDEX "ClientActivity_clientId_occurredAt_idx" ON "ClientActivity"("clientId", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "Project_code_key" ON "Project"("code");

-- CreateIndex
CREATE INDEX "Project_clientId_idx" ON "Project"("clientId");

-- CreateIndex
CREATE INDEX "Project_approved_approvalDate_idx" ON "Project"("approved", "approvalDate");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseOrder_poNumber_key" ON "PurchaseOrder"("poNumber");

-- CreateIndex
CREATE INDEX "PurchaseOrder_clientId_idx" ON "PurchaseOrder"("clientId");

-- CreateIndex
CREATE INDEX "PurchaseOrder_projectId_idx" ON "PurchaseOrder"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentMilestone_poId_sequence_key" ON "PaymentMilestone"("poId", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_invoiceNumber_key" ON "Invoice"("invoiceNumber");

-- CreateIndex
CREATE INDEX "Invoice_poId_status_idx" ON "Invoice"("poId", "status");

-- CreateIndex
CREATE INDEX "Invoice_clientId_idx" ON "Invoice"("clientId");

-- CreateIndex
CREATE INDEX "Invoice_dueDate_idx" ON "Invoice"("dueDate");

-- CreateIndex
CREATE UNIQUE INDEX "InvoiceDocument_invoiceId_version_key" ON "InvoiceDocument"("invoiceId", "version");

-- CreateIndex
CREATE INDEX "Attachment_entityType_entityId_idx" ON "Attachment"("entityType", "entityId");

-- CreateIndex
CREATE UNIQUE INDEX "ExchangeRate_fromCurrency_toCurrency_effectiveDate_key" ON "ExchangeRate"("fromCurrency", "toCurrency", "effectiveDate");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_idx" ON "AuditLog"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- AddForeignKey
ALTER TABLE "ClientContact" ADD CONSTRAINT "ClientContact_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientActivity" ADD CONSTRAINT "ClientActivity_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientActivity" ADD CONSTRAINT "ClientActivity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentMilestone" ADD CONSTRAINT "PaymentMilestone_poId_fkey" FOREIGN KEY ("poId") REFERENCES "PurchaseOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_poId_fkey" FOREIGN KEY ("poId") REFERENCES "PurchaseOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_milestoneId_fkey" FOREIGN KEY ("milestoneId") REFERENCES "PaymentMilestone"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_finalizedById_fkey" FOREIGN KEY ("finalizedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_cancelledById_fkey" FOREIGN KEY ("cancelledById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceLineItem" ADD CONSTRAINT "InvoiceLineItem_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceDocument" ADD CONSTRAINT "InvoiceDocument_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ───────────── Business-rule guards (BRD §5.4, §5.5.3, §5.10, §9 data integrity) ─────────────

-- Non-negative money / sane percentages
ALTER TABLE "Project" ADD CONSTRAINT "Project_value_nonneg" CHECK ("value" >= 0);
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PO_value_positive" CHECK ("value" > 0);
ALTER TABLE "PaymentMilestone" ADD CONSTRAINT "Milestone_pct_range" CHECK ("percentage" > 0 AND "percentage" <= 100);
ALTER TABLE "PaymentMilestone" ADD CONSTRAINT "Milestone_amount_nonneg" CHECK ("amount" >= 0);
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_amounts_valid" CHECK (
  "subtotal" > 0 AND "discount" >= 0 AND "discount" <= "subtotal"
  AND "taxAmount" >= 0 AND "total" >= 0 AND "amountPaid" >= 0 AND "amountPaid" <= "total"
);

-- BR-06: a milestone can have only one valid (non-cancelled) invoice
CREATE UNIQUE INDEX "Invoice_active_milestone_key" ON "Invoice" ("milestoneId")
  WHERE "milestoneId" IS NOT NULL AND "status" <> 'CANCELLED';

-- BR-07 / BR-08: strict PO cap, enforced in the database so no code path (or admin) can bypass it.
-- Locks the PO row, so concurrent inserts against the same PO are serialized.
CREATE OR REPLACE FUNCTION enforce_po_invoice_cap() RETURNS trigger AS $$
DECLARE
  po_value  numeric(18,2);
  po_status text;
  po_cur    text;
  used      numeric(18,2);
BEGIN
  IF NEW."status" = 'CANCELLED' THEN
    RETURN NEW;
  END IF;

  SELECT "value", "status"::text, "currency" INTO po_value, po_status, po_cur
    FROM "PurchaseOrder" WHERE "id" = NEW."poId" FOR UPDATE;

  IF po_status NOT IN ('APPROVED', 'COMPLETED') THEN
    RAISE EXCEPTION 'PO_NOT_APPROVED: invoices can only be raised against an approved PO'
      USING ERRCODE = 'P0001';
  END IF;

  IF NEW."currency" <> po_cur THEN
    RAISE EXCEPTION 'CURRENCY_MISMATCH: invoice currency must match PO currency' USING ERRCODE = 'P0001';
  END IF;

  SELECT COALESCE(SUM("subtotal" - "discount"), 0) INTO used
    FROM "Invoice"
   WHERE "poId" = NEW."poId" AND "status" <> 'CANCELLED' AND "id" <> NEW."id";

  IF used + (NEW."subtotal" - NEW."discount") > po_value THEN
    RAISE EXCEPTION 'PO_CAP_EXCEEDED: invoices would total % against PO value %',
      used + (NEW."subtotal" - NEW."discount"), po_value USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER invoice_po_cap
  BEFORE INSERT OR UPDATE OF "subtotal", "discount", "status", "poId" ON "Invoice"
  FOR EACH ROW EXECUTE FUNCTION enforce_po_invoice_cap();

-- A PO's value can never drop below what has already been validly invoiced against it.
CREATE OR REPLACE FUNCTION enforce_po_value_floor() RETURNS trigger AS $$
DECLARE used numeric(18,2);
BEGIN
  IF NEW."value" < OLD."value" THEN
    SELECT COALESCE(SUM("subtotal" - "discount"), 0) INTO used
      FROM "Invoice" WHERE "poId" = NEW."id" AND "status" <> 'CANCELLED';
    IF NEW."value" < used THEN
      RAISE EXCEPTION 'PO_CAP_EXCEEDED: PO value % is below already invoiced %', NEW."value", used
        USING ERRCODE = 'P0001';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER po_value_floor
  BEFORE UPDATE OF "value" ON "PurchaseOrder"
  FOR EACH ROW EXECUTE FUNCTION enforce_po_value_floor();

-- Audit log is append-only.
CREATE OR REPLACE FUNCTION audit_log_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'AUDIT_IMMUTABLE: audit records cannot be changed or deleted' USING ERRCODE = 'P0001';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_log_no_update BEFORE UPDATE OR DELETE ON "AuditLog"
  FOR EACH ROW EXECUTE FUNCTION audit_log_append_only();
