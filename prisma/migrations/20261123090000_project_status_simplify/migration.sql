-- Project status simplified to: Draft, In Progress, On Hold, Completed, Cancelled.
-- Map the retired statuses onto the new set before shrinking the enum.
UPDATE "Project" SET "status" = 'DRAFT', "approved" = false WHERE "status" IN ('PROPOSED', 'SUBMITTED');
UPDATE "Project" SET "status" = 'IN_PROGRESS', "approved" = true WHERE "status" = 'APPROVED';
UPDATE "Project" SET "status" = 'CANCELLED', "approved" = false WHERE "status" = 'REJECTED';

ALTER TYPE "ProjectStatus" RENAME TO "ProjectStatus_old";
CREATE TYPE "ProjectStatus" AS ENUM ('DRAFT', 'IN_PROGRESS', 'ON_HOLD', 'COMPLETED', 'CANCELLED');
ALTER TABLE "Project" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "Project" ALTER COLUMN "status" TYPE "ProjectStatus" USING ("status"::text::"ProjectStatus");
ALTER TABLE "Project" ALTER COLUMN "status" SET DEFAULT 'DRAFT';
DROP TYPE "ProjectStatus_old";
