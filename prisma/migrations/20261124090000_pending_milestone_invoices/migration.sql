-- Milestone invoices are now drafted as soon as a PO is submitted for approval ("pending approval").
-- Draft invoices may exist on a submitted / on-hold PO; issuing one (any non-draft status) still requires
-- an approved PO. The PO cap and currency checks apply in every case.
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
