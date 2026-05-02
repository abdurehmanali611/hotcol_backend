-- AlterTable waiter: add income timestamps per payment entry (aligned with price/payment arrays)
ALTER TABLE `waiter` ADD COLUMN `incomeAt` JSON NULL;
UPDATE `waiter` SET `incomeAt` = CAST('[]' AS JSON) WHERE `incomeAt` IS NULL;
ALTER TABLE `waiter` MODIFY COLUMN `incomeAt` JSON NOT NULL;

-- AlterTable table
ALTER TABLE `table` ADD COLUMN `incomeAt` JSON NULL;
UPDATE `table` SET `incomeAt` = CAST('[]' AS JSON) WHERE `incomeAt` IS NULL;
ALTER TABLE `table` MODIFY COLUMN `incomeAt` JSON NOT NULL;
