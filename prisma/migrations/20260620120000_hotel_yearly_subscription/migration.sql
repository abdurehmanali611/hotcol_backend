-- Hotels (unhold): extend paid-until by 9 months — quarterly → yearly schedule.
UPDATE `user`
SET
  `subscriptionPaidUntil` = DATE_ADD(`subscriptionPaidUntil`, INTERVAL 9 MONTH),
  `billingNotes` = CONCAT(
    COALESCE(`billingNotes`, ''),
    CASE
      WHEN `billingNotes` IS NOT NULL AND TRIM(`billingNotes`) != '' THEN ' | '
      ELSE ''
    END,
    'Migrated to yearly subscription — paid-until extended +9 months'
  )
WHERE `billingHold` = false
  AND `isIllustrationTenant` = false
  AND COALESCE(`quarterlyFeeETB`, 0) > 0
  AND `subscriptionPaidUntil` IS NOT NULL
  AND TRIM(COALESCE(`businessType`, '')) IN ('Hotel', 'Resort', 'Pension');
