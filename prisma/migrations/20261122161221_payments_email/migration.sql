-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('BANK_TRANSFER', 'CHEQUE', 'CASH', 'CARD', 'ONLINE', 'OTHER');

-- CreateEnum
CREATE TYPE "PaymentState" AS ENUM ('VALID', 'REVERSED');

-- CreateEnum
CREATE TYPE "EmailStatus" AS ENUM ('SENT', 'FAILED');

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "paymentDate" DATE NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "reference" TEXT,
    "receivingAccount" TEXT,
    "notes" TEXT,
    "receiptPath" TEXT,
    "receiptName" TEXT,
    "receiptMime" TEXT,
    "state" "PaymentState" NOT NULL DEFAULT 'VALID',
    "recordedById" TEXT,
    "reversedAt" TIMESTAMP(3),
    "reversedById" TEXT,
    "reversalReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailTemplate" (
    "key" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmailTemplate_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "InvoiceEmailLog" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "senderId" TEXT,
    "fromAddress" TEXT NOT NULL,
    "toAddresses" TEXT[],
    "ccAddresses" TEXT[],
    "bccAddresses" TEXT[],
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "attachmentName" TEXT NOT NULL,
    "attachmentSha256" TEXT NOT NULL,
    "status" "EmailStatus" NOT NULL,
    "providerMessageId" TEXT,
    "providerResponse" TEXT,
    "error" TEXT,
    "transport" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InvoiceEmailLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Payment_invoiceId_idx" ON "Payment"("invoiceId");

-- CreateIndex
CREATE INDEX "Payment_paymentDate_idx" ON "Payment"("paymentDate");

-- CreateIndex
CREATE INDEX "InvoiceEmailLog_invoiceId_createdAt_idx" ON "InvoiceEmailLog"("invoiceId", "createdAt");

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_reversedById_fkey" FOREIGN KEY ("reversedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceEmailLog" ADD CONSTRAINT "InvoiceEmailLog_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceEmailLog" ADD CONSTRAINT "InvoiceEmailLog_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ───────────── Payment guards (BRD §5.6, BR-11) ─────────────

ALTER TABLE "Payment" ADD CONSTRAINT "Payment_amount_positive" CHECK ("amount" > 0);

-- Validate a new/changed payment against its invoice, under a row lock on the invoice.
CREATE OR REPLACE FUNCTION payment_guard() RETURNS trigger AS $$
DECLARE
  inv_total  numeric(18,2);
  inv_status text;
  inv_cur    text;
  paid       numeric(18,2);
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'PAYMENT_IMMUTABLE: payments cannot be deleted; reverse them instead' USING ERRCODE = 'P0001';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF OLD."state" = 'REVERSED' THEN
      RAISE EXCEPTION 'PAYMENT_IMMUTABLE: a reversed payment cannot be changed' USING ERRCODE = 'P0001';
    END IF;
    IF NEW."amount" <> OLD."amount" OR NEW."invoiceId" <> OLD."invoiceId" OR NEW."currency" <> OLD."currency"
       OR NEW."paymentDate" <> OLD."paymentDate" THEN
      RAISE EXCEPTION 'PAYMENT_IMMUTABLE: payment amounts and dates cannot be edited; reverse and re-record' USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;  -- only VALID -> REVERSED (and its metadata) gets here
  END IF;

  SELECT "total", "status"::text, "currency" INTO inv_total, inv_status, inv_cur
    FROM "Invoice" WHERE "id" = NEW."invoiceId" FOR UPDATE;

  IF inv_status NOT IN ('UNPAID', 'PARTIALLY_PAID') THEN
    RAISE EXCEPTION 'PAYMENT_NOT_ALLOWED: payments can only be recorded on issued, unpaid invoices' USING ERRCODE = 'P0001';
  END IF;
  IF NEW."currency" <> inv_cur THEN
    RAISE EXCEPTION 'CURRENCY_MISMATCH: payment currency must match the invoice currency' USING ERRCODE = 'P0001';
  END IF;
  SELECT COALESCE(SUM("amount"), 0) INTO paid FROM "Payment"
   WHERE "invoiceId" = NEW."invoiceId" AND "state" = 'VALID';
  IF paid + NEW."amount" > inv_total THEN
    RAISE EXCEPTION 'OVERPAYMENT: payment of % exceeds the outstanding balance of %', NEW."amount", inv_total - paid
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER payment_guard
  BEFORE INSERT OR UPDATE OR DELETE ON "Payment"
  FOR EACH ROW EXECUTE FUNCTION payment_guard();

-- BR-11: invoice paid amount and payment status are always derived from valid payments.
CREATE OR REPLACE FUNCTION payment_sync_invoice() RETURNS trigger AS $$
DECLARE
  paid numeric(18,2);
  t    numeric(18,2);
  s    text;
BEGIN
  SELECT COALESCE(SUM("amount"), 0) INTO paid FROM "Payment"
   WHERE "invoiceId" = NEW."invoiceId" AND "state" = 'VALID';
  SELECT "total", "status"::text INTO t, s FROM "Invoice" WHERE "id" = NEW."invoiceId";
  IF s IN ('DRAFT', 'CANCELLED') THEN
    RETURN NULL;
  END IF;
  UPDATE "Invoice"
     SET "amountPaid" = paid,
         "status" = (CASE WHEN paid = 0 THEN 'UNPAID' WHEN paid < t THEN 'PARTIALLY_PAID' ELSE 'PAID' END)::"InvoiceStatus",
         "updatedAt" = now()
   WHERE "id" = NEW."invoiceId";
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER payment_sync_invoice
  AFTER INSERT OR UPDATE ON "Payment"
  FOR EACH ROW EXECUTE FUNCTION payment_sync_invoice();

-- Email log is an append-only record of send attempts.
CREATE TRIGGER email_log_append_only BEFORE UPDATE OR DELETE ON "InvoiceEmailLog"
  FOR EACH ROW EXECUTE FUNCTION audit_log_append_only();
