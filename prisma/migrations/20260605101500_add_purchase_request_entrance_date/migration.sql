ALTER TABLE `PurchaseRequest`
ADD COLUMN `entranceDate` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3);

-- New column defaults to migration time; align existing lines with when they were sent.
UPDATE `PurchaseRequest`
SET `entranceDate` = `createdAt`;
