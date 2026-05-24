-- Illustration tenants, billing hold, free trial, custom fee notes.
ALTER TABLE `user` ADD COLUMN IF NOT EXISTS `isIllustrationTenant` BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE `user` ADD COLUMN IF NOT EXISTS `billingHold` BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE `user` ADD COLUMN IF NOT EXISTS `billingStartedAt` DATETIME(3) NULL;
ALTER TABLE `user` ADD COLUMN IF NOT EXISTS `freeTrialEndsAt` DATETIME(3) NULL;
ALTER TABLE `user` ADD COLUMN IF NOT EXISTS `billingNotes` TEXT NULL;

-- All existing properties: billing on hold (quarters start when hold is released).
UPDATE `user` SET `billingHold` = true;

-- Illustration / demo properties — no payment.
UPDATE `user`
SET
  `isIllustrationTenant` = true,
  `billingHold` = false,
  `setupFeeApproved` = true,
  `subscriptionPaymentApproved` = true,
  `setupFeeETB` = 0,
  `quarterlyFeeETB` = 0,
  `paidQuartersCount` = 0,
  `subscriptionPaidUntil` = NULL,
  `billingNotes` = 'Illustration / demo property — no payment'
WHERE LOWER(TRIM(`HotelName`)) LIKE '%apex cafe%'
   OR LOWER(TRIM(`HotelName`)) = 'apex cafe and restaurant';

UPDATE `user`
SET
  `isIllustrationTenant` = true,
  `billingHold` = false,
  `setupFeeApproved` = true,
  `subscriptionPaymentApproved` = true,
  `setupFeeETB` = 0,
  `quarterlyFeeETB` = 0,
  `paidQuartersCount` = 0,
  `subscriptionPaidUntil` = NULL,
  `billingNotes` = 'Illustration / demo property — no payment'
WHERE LOWER(TRIM(`HotelName`)) LIKE '%apex hotel%';

-- First-client setup discounts.
UPDATE `user`
SET
  `setupFeeETB` = 15000,
  `setupFeeApproved` = true,
  `billingNotes` = 'First café client — setup 15,000 ETB'
WHERE LOWER(TRIM(`HotelName`)) LIKE '%hafina%';

UPDATE `user`
SET
  `setupFeeETB` = 25000,
  `setupFeeApproved` = true,
  `billingNotes` = 'First hotel client — setup 25,000 ETB'
WHERE LOWER(TRIM(`HotelName`)) LIKE '%gebretsadik%';

UPDATE `user`
SET
  `setupFeeETB` = 25000,
  `setupFeeApproved` = true,
  `billingNotes` = 'First hotel client — setup 25,000 ETB'
WHERE LOWER(TRIM(`HotelName`)) LIKE '%ella kitchen%';

-- On-hold tenants: pause quarter counter until billingStartedAt is set on release.
UPDATE `user`
SET
  `billingStartedAt` = NULL,
  `paidQuartersCount` = 0,
  `subscriptionPaidUntil` = NULL
WHERE `billingHold` = true AND `isIllustrationTenant` = false;
