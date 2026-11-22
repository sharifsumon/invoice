-- AlterTable
ALTER TABLE "ClientContact" ADD COLUMN     "firstName" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "lastName" TEXT NOT NULL DEFAULT '';

-- Backfill existing contacts: first word -> firstName, remainder -> lastName.
UPDATE "ClientContact"
   SET "firstName" = split_part(btrim("name"), ' ', 1),
       "lastName"  = btrim(substr(btrim("name"), length(split_part(btrim("name"), ' ', 1)) + 1));
