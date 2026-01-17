-- CreateTable
CREATE TABLE `user` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `UserName` VARCHAR(191) NOT NULL,
    `Password` VARCHAR(191) NOT NULL,
    `HotelName` VARCHAR(191) NOT NULL,
    `Role` VARCHAR(191) NOT NULL,
    `LogoUrl` VARCHAR(191) NULL,

    UNIQUE INDEX `user_UserName_key`(`UserName`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Item` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(191) NOT NULL,
    `price` DOUBLE NOT NULL,
    `category` VARCHAR(191) NOT NULL,
    `type` VARCHAR(191) NOT NULL,
    `HotelName` VARCHAR(191) NOT NULL,
    `imageUrl` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `cashouts` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `Amount` INTEGER NOT NULL,
    `Reason` JSON NOT NULL,
    `HotelName` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Order` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `title` VARCHAR(191) NOT NULL,
    `imageUrl` VARCHAR(191) NOT NULL,
    `tableNo` INTEGER NOT NULL,
    `category` VARCHAR(191) NOT NULL,
    `type` VARCHAR(191) NOT NULL,
    `orderAmount` INTEGER NOT NULL,
    `HotelName` VARCHAR(191) NOT NULL,
    `price` DOUBLE NOT NULL,
    `waiterName` VARCHAR(191) NOT NULL,
    `status` VARCHAR(191) NULL,
    `payment` VARCHAR(191) NULL,
    `withBank` BOOLEAN NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `waiter` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(191) NOT NULL,
    `HotelName` VARCHAR(191) NOT NULL,
    `sex` VARCHAR(191) NOT NULL,
    `age` INTEGER NOT NULL,
    `experience` INTEGER NOT NULL,
    `phoneNumber` VARCHAR(191) NOT NULL,
    `price` JSON NOT NULL,
    `tablesServed` JSON NOT NULL,
    `payment` JSON NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `table` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `tableNo` INTEGER NOT NULL,
    `capacity` INTEGER NOT NULL,
    `price` JSON NOT NULL,
    `payment` JSON NOT NULL,
    `HotelName` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
