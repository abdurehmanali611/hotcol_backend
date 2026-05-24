-- Subscription billing columns on tenant owner (MySQL).
ALTER TABLE `user` ADD COLUMN IF NOT EXISTS `setupFeeETB` INT NULL;
ALTER TABLE `user` ADD COLUMN IF NOT EXISTS `quarterlyFeeETB` INT NULL;
ALTER TABLE `user` ADD COLUMN IF NOT EXISTS `paymentChannel` VARCHAR(191) NULL;
ALTER TABLE `user` ADD COLUMN IF NOT EXISTS `paymentTransactionRef` VARCHAR(191) NULL;
ALTER TABLE `user` ADD COLUMN IF NOT EXISTS `registeredAt` DATETIME(3) NULL;
ALTER TABLE `user` ADD COLUMN IF NOT EXISTS `subscriptionPaidUntil` DATETIME(3) NULL;
ALTER TABLE `user` ADD COLUMN IF NOT EXISTS `subscriptionPaymentApproved` BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE `user` ADD COLUMN IF NOT EXISTS `setupFeeApproved` BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE `user` ADD COLUMN IF NOT EXISTS `paidQuartersCount` INT NOT NULL DEFAULT 0;
ALTER TABLE `user` ADD COLUMN IF NOT EXISTS `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3);

CREATE TABLE IF NOT EXISTS `tenant_payment_submission` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `tinNumber` VARCHAR(191) NOT NULL,
  `paymentKind` VARCHAR(191) NOT NULL,
  `amountETB` INT NOT NULL,
  `paymentChannel` VARCHAR(191) NOT NULL,
  `transactionRef` VARCHAR(191) NOT NULL,
  `status` VARCHAR(191) NOT NULL DEFAULT 'pending',
  `submittedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `submittedByUserId` INT NULL,
  `approvedAt` DATETIME(3) NULL,
  `quarterNumber` INT NULL,
  PRIMARY KEY (`id`),
  INDEX `tenant_payment_submission_tinNumber_idx` (`tinNumber`),
  INDEX `tenant_payment_submission_status_idx` (`status`),
  INDEX `tenant_payment_submission_tin_kind_status_idx` (`tinNumber`, `paymentKind`, `status`)
);

-- Existing cafés/hotels: treat setup as paid; quarter 1 starts from registration (createdAt).
UPDATE `user` u
INNER JOIN (
  SELECT MIN(`id`) AS `ownerId`
  FROM `user`
  WHERE `Role` IN ('Admin', 'Manager')
  GROUP BY COALESCE(NULLIF(TRIM(`tinNumber`), ''), TRIM(`HotelName`))
) o ON u.`id` = o.`ownerId`
SET
  u.`registeredAt` = COALESCE(u.`registeredAt`, u.`createdAt`),
  u.`setupFeeApproved` = true,
  u.`subscriptionPaymentApproved` = true,
  u.`paidQuartersCount` = GREATEST(COALESCE(u.`paidQuartersCount`, 0), 1),
  u.`subscriptionPaidUntil` = COALESCE(
    u.`subscriptionPaidUntil`,
    DATE_ADD(COALESCE(u.`registeredAt`, u.`createdAt`), INTERVAL 90 DAY)
  )
WHERE u.`registeredAt` IS NULL OR u.`setupFeeApproved` = false;
