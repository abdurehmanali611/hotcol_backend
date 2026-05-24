-- Copy Manager/Admin module list to staff in the same property when modules are missing.
UPDATE `user` u
INNER JOIN (
  SELECT
    COALESCE(NULLIF(TRIM(m.`tinNumber`), ''), TRIM(m.`HotelName`)) AS tenant_key,
    m.`modules` AS owner_modules
  FROM `user` m
  INNER JOIN (
    SELECT
      COALESCE(NULLIF(TRIM(`tinNumber`), ''), TRIM(`HotelName`)) AS tenant_key,
      MIN(`id`) AS owner_id
    FROM `user`
    WHERE `Role` IN ('Admin', 'Manager')
      AND `modules` IS NOT NULL
      AND JSON_LENGTH(`modules`) > 0
    GROUP BY tenant_key
  ) o
    ON m.`id` = o.owner_id
) src
  ON COALESCE(NULLIF(TRIM(u.`tinNumber`), ''), TRIM(u.`HotelName`)) = src.tenant_key
SET u.`modules` = src.owner_modules
WHERE u.`Role` IN ('Store', 'Finance', 'CostControl', 'HotelCashier', 'Cashier', 'Kitchen', 'Barista')
  AND (
    u.`modules` IS NULL
    OR JSON_LENGTH(u.`modules`) = 0
    OR CAST(u.`modules` AS CHAR) = '[]'
  );

-- Legacy owners: setup treated as paid; quarter 1 anchored to createdAt (run pricing script for exact ETB tiers).
UPDATE `user` u
INNER JOIN (
  SELECT MIN(`id`) AS owner_id
  FROM `user`
  WHERE `Role` IN ('Admin', 'Manager')
  GROUP BY COALESCE(NULLIF(TRIM(`tinNumber`), ''), TRIM(`HotelName`))
) o ON u.`id` = o.owner_id
SET
  u.`setupFeeApproved` = true,
  u.`subscriptionPaymentApproved` = true,
  u.`paidQuartersCount` = GREATEST(COALESCE(u.`paidQuartersCount`, 0), 1),
  u.`subscriptionPaidUntil` = COALESCE(
    u.`subscriptionPaidUntil`,
    DATE_ADD(u.`createdAt`, INTERVAL 90 DAY)
  );

-- Billing anchor is createdAt only — drop redundant registeredAt.
ALTER TABLE `user` DROP COLUMN `registeredAt`;
