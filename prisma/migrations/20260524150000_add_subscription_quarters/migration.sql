-- Quarterly billing anchored to registration date; Apex approval extends paid quarters.
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "registeredAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "subscriptionPaidUntil" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "subscriptionPaymentApproved" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "paidQuartersCount" INTEGER NOT NULL DEFAULT 0;
