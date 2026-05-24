-- Setup fee payment proof captured at business registration.
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "paymentChannel" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "paymentTransactionRef" TEXT;
