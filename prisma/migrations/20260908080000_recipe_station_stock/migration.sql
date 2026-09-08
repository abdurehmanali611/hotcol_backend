-- Recipe-based station stock for café/restaurant + inventory

CREATE TABLE `StationIngredientStock` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `HotelName` VARCHAR(191) NOT NULL,
    `station` VARCHAR(191) NOT NULL,
    `itemName` VARCHAR(191) NOT NULL,
    `measuredBy` VARCHAR(191) NOT NULL DEFAULT '',
    `unitPrice` DOUBLE NOT NULL DEFAULT 0,
    `amount` DOUBLE NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `StationIngredientStock_HotelName_station_itemName_key`(`HotelName`, `station`, `itemName`),
    INDEX `StationIngredientStock_HotelName_idx`(`HotelName`),
    INDEX `StationIngredientStock_HotelName_station_idx`(`HotelName`, `station`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `RecipeStockConsumption` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `HotelName` VARCHAR(191) NOT NULL,
    `orderId` INTEGER NOT NULL,
    `menuItemTitle` VARCHAR(191) NOT NULL,
    `orderAmount` INTEGER NOT NULL,
    `station` VARCHAR(191) NOT NULL,
    `ingredientName` VARCHAR(191) NOT NULL,
    `amount` DOUBLE NOT NULL,
    `measuredBy` VARCHAR(191) NOT NULL DEFAULT '',
    `unitPrice` DOUBLE NOT NULL DEFAULT 0,
    `shortfallAmount` DOUBLE NOT NULL DEFAULT 0,
    `completedBy` VARCHAR(191) NOT NULL DEFAULT '',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `RecipeStockConsumption_HotelName_idx`(`HotelName`),
    INDEX `RecipeStockConsumption_HotelName_createdAt_idx`(`HotelName`, `createdAt`),
    INDEX `RecipeStockConsumption_orderId_idx`(`orderId`),
    INDEX `RecipeStockConsumption_HotelName_station_ingredientName_idx`(`HotelName`, `station`, `ingredientName`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
