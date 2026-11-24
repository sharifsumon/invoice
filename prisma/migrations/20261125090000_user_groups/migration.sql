-- User groups replace fixed roles. Each built-in role becomes a group with the same permissions
-- (action "cancel" is now "delete"; recording/reversing payments is its own "payments" action),
-- every user moves into the group of their old role, and notification settings follow.

CREATE TABLE "UserGroup" (
    "id" TEXT NOT NULL,
    "key" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "permissions" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "UserGroup_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "UserGroup_key_key" ON "UserGroup"("key");
CREATE UNIQUE INDEX "UserGroup_name_key" ON "UserGroup"("name");

INSERT INTO "UserGroup" ("id", "key", "name", "description", "permissions", "updatedAt") VALUES
('grp_admin', 'ADMIN', 'Administrator', 'Full access to everything',
 '{"clients":["view","create","edit","delete","export"],"projects":["view","create","edit","delete","approve","export"],"pos":["view","create","edit","delete","approve","export"],"invoices":["view","create","edit","delete","approve","payments","email","export"],"users":["view","create","edit","delete","groups"],"reports":["view","export"],"audit":["view","export"],"settings":["administer"]}', now()),
('grp_management', 'MANAGEMENT', 'Management', 'Approves projects and POs; read-only elsewhere',
 '{"clients":["view","export"],"projects":["view","approve","export"],"pos":["view","approve","export"],"invoices":["view","export"],"reports":["view","export"],"audit":["view"]}', now()),
('grp_bd', 'BUSINESS_DEVELOPMENT', 'Business Development', 'Manages clients and projects',
 '{"clients":["view","create","edit","delete","export"],"projects":["view","create","edit","delete"],"pos":["view"],"invoices":["view"]}', now()),
('grp_pm', 'PROJECT_MANAGER', 'Project Manager', 'Manages projects',
 '{"clients":["view"],"projects":["view","create","edit","delete"],"pos":["view"],"invoices":["view"]}', now()),
('grp_finance', 'FINANCE', 'Finance', 'POs, invoices and payments',
 '{"clients":["view","export"],"projects":["view"],"pos":["view","create","edit","delete","approve","export"],"invoices":["view","create","edit","delete","approve","payments","email","export"],"reports":["view","export"]}', now()),
('grp_viewer', 'VIEWER', 'Viewer', 'Read-only',
 '{"clients":["view"],"projects":["view"],"pos":["view"],"invoices":["view"],"reports":["view"]}', now());

-- Users → groups
ALTER TABLE "User" ADD COLUMN "groupId" TEXT;
UPDATE "User" u SET "groupId" = g."id" FROM "UserGroup" g WHERE g."key" = u."role"::text;
ALTER TABLE "User" ALTER COLUMN "groupId" SET NOT NULL;
ALTER TABLE "User" ADD CONSTRAINT "User_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "UserGroup"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "User" DROP COLUMN "role";

-- Notification settings → groups
ALTER TABLE "NotificationSetting" ADD COLUMN "groupId" TEXT;
UPDATE "NotificationSetting" n SET "groupId" = g."id" FROM "UserGroup" g WHERE g."key" = n."role"::text;
DELETE FROM "NotificationSetting" WHERE "groupId" IS NULL;
ALTER TABLE "NotificationSetting" DROP CONSTRAINT "NotificationSetting_pkey";
ALTER TABLE "NotificationSetting" DROP COLUMN "role";
ALTER TABLE "NotificationSetting" ALTER COLUMN "groupId" SET NOT NULL;
ALTER TABLE "NotificationSetting" ADD CONSTRAINT "NotificationSetting_pkey" PRIMARY KEY ("event", "groupId");
ALTER TABLE "NotificationSetting" ADD CONSTRAINT "NotificationSetting_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "UserGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

DROP TYPE "Role";
