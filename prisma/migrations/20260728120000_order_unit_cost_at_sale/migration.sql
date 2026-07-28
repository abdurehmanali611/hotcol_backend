-- Freeze per-serving ingredient cost on each order line at sale time so
-- café revenue/profit reports keep historical prices after menu Item.price
-- or recipeJson updates.
ALTER TABLE `Order` ADD COLUMN `unitCostAtSale` DOUBLE NULL;
