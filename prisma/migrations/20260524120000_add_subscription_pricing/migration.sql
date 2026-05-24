-- Module pricing captured at business registration.
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "setupFeeETB" INTEGER;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "quarterlyFeeETB" INTEGER;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "modules" JSONB;
