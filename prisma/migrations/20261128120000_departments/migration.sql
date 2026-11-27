-- Departments become a managed list; requisitions pick one instead of typing free text.
-- Requisitions no longer link to a project.
CREATE TABLE "Department" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Department_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Department_name_key" ON "Department"("name");

-- Keep any department already typed on a requisition.
INSERT INTO "Department" ("id", "name", "updatedAt")
SELECT DISTINCT ON (lower(trim("department"))) 'dep_' || md5(lower(trim("department"))), trim("department"), now()
  FROM "Requisition" WHERE "department" IS NOT NULL AND trim("department") <> '';

ALTER TABLE "Requisition" ADD COLUMN "departmentId" TEXT;
UPDATE "Requisition" r SET "departmentId" = d."id"
  FROM "Department" d WHERE lower(trim(r."department")) = lower(d."name");
ALTER TABLE "Requisition" ADD CONSTRAINT "Requisition_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "Requisition_departmentId_idx" ON "Requisition"("departmentId");

ALTER TABLE "Requisition" DROP COLUMN "department";
ALTER TABLE "Requisition" DROP CONSTRAINT "Requisition_projectId_fkey";
ALTER TABLE "Requisition" DROP COLUMN "projectId";
