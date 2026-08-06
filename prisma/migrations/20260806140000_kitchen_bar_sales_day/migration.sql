-- Editable station sales for daily chef/bar counts (null = legacy derived sales).
ALTER TABLE `KitchenBarBeginning` ADD COLUMN `salesDay` DOUBLE NULL;
