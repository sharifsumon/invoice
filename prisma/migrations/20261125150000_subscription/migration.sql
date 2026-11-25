-- Subscription: 14-day free trial from company setup (existing installs: from today), then a plan.
-- Timestamps are stored as UTC (like the rest of the schema), so the default is computed in UTC.
ALTER TABLE "CompanySettings" ADD COLUMN "trialEndsAt" TIMESTAMP(3) NOT NULL DEFAULT ((now() AT TIME ZONE 'UTC') + '14 days'::interval);
ALTER TABLE "CompanySettings" ADD COLUMN "plan" TEXT;
ALTER TABLE "CompanySettings" ADD COLUMN "planStartedAt" TIMESTAMP(3);
