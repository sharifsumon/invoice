-- AI assistant: encrypted Google API key + model on company settings; the Administrator group may use it.
ALTER TABLE "CompanySettings" ADD COLUMN "aiApiKeyEnc" TEXT;
ALTER TABLE "CompanySettings" ADD COLUMN "aiModel" TEXT NOT NULL DEFAULT 'gemini-flash-latest';

UPDATE "UserGroup" SET "permissions" = "permissions" || '{"assistant":["view"]}'::jsonb WHERE "key" = 'ADMIN';
