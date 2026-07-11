-- Receiving department on archive: only KITCHEN lines are true fresh bazaar.
ALTER TABLE `FreshBazaar` ADD COLUMN `receivedByDepartment` VARCHAR(191) NOT NULL DEFAULT 'KITCHEN';
