-- Balance invoices: when an invoice is part-paid, its unpaid balance can be carried forward to a new
-- BALANCE invoice. The original keeps its total and payments (status Partially Paid) and records the moved
-- amount, so the same money is never outstanding twice and never billed twice against the PO.
ALTER TYPE "InvoiceKind" ADD VALUE 'BALANCE';

ALTER TABLE "Invoice" ADD COLUMN "balanceOfId" TEXT;
ALTER TABLE "Invoice" ADD COLUMN "balanceMoved" DECIMAL(18,2) NOT NULL DEFAULT 0;
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_balanceOfId_fkey"
  FOREIGN KEY ("balanceOfId") REFERENCES "Invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_balanceMoved_valid"
  CHECK ("balanceMoved" >= 0 AND "amountPaid" + "balanceMoved" <= "total");

-- At most one live (non-cancelled) balance invoice per original.
CREATE UNIQUE INDEX "Invoice_active_balance_key" ON "Invoice" ("balanceOfId")
  WHERE "balanceOfId" IS NOT NULL AND "status" <> 'CANCELLED';

-- PO cap: a balance invoice re-bills money already counted on its original, so it is not new usage.
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

-- Overpayment check: whatever was moved to a balance invoice is no longer payable here.
CREATE OR REPLACE FUNCTION payment_guard() RETURNS trigger AS $$
DECLARE
  inv_total  numeric(18,2);
  inv_moved  numeric(18,2);
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

  SELECT "total", "balanceMoved", "status"::text, "currency" INTO inv_total, inv_moved, inv_status, inv_cur
    FROM "Invoice" WHERE "id" = NEW."invoiceId" FOR UPDATE;

  IF inv_status NOT IN ('UNPAID', 'PARTIALLY_PAID') THEN
    RAISE EXCEPTION 'PAYMENT_NOT_ALLOWED: payments can only be recorded on issued, unpaid invoices' USING ERRCODE = 'P0001';
  END IF;
  IF NEW."currency" <> inv_cur THEN
    RAISE EXCEPTION 'CURRENCY_MISMATCH: payment currency must match the invoice currency' USING ERRCODE = 'P0001';
  END IF;
  SELECT COALESCE(SUM("amount"), 0) INTO paid FROM "Payment"
   WHERE "invoiceId" = NEW."invoiceId" AND "state" = 'VALID';
  IF paid + NEW."amount" > inv_total - inv_moved THEN
    RAISE EXCEPTION 'OVERPAYMENT: payment of % exceeds the outstanding balance of %', NEW."amount", inv_total - inv_moved - paid
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
